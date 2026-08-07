/**
 * Payout store — seller withdrawal requests.
 * Persistence: in-memory + JSON file (data/payouts.json), tmp+rename atomic.
 */
import fs from "fs";
import path from "path";
import { newId, db } from "./store";
import { getBalance, debitAgent } from "./agent-ledger";

export type PayoutMethod = "hbar" | "usdc" | "manual";

export type PayoutRecord = {
  id: string;
  agentId: string;
  amount: number;
  method: PayoutMethod;
  account: string | null;
  status: "requested" | "approved" | "paid" | "rejected";
  /** Optional orderId — links a payout to the sale that generated it. */
  orderId?: string;
  adminNote?: string;
  createdAt: string;
  processedAt?: string;
};

const FILE = process.env.OM_DATA_DIR
  ? path.join(process.env.OM_DATA_DIR, "payouts.json")
  : path.join(process.cwd(), "data", "payouts.json");

let cache: PayoutRecord[] | null = null;

function load(): PayoutRecord[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    cache = [];
  }
  return cache!;
}

function persist() {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(load(), null, 2));
  fs.renameSync(tmp, FILE);
}

export function addPayout(input: {
  agentId: string;
  amount: number;
  method: PayoutMethod;
  account: string | null;
  orderId?: string;
}): PayoutRecord {
  const rec: PayoutRecord = {
    id: newId("pout"),
    agentId: input.agentId,
    amount: input.amount,
    method: input.method,
    account: input.account,
    status: "requested",
    orderId: input.orderId,
    createdAt: new Date().toISOString(),
  };
  load().push(rec);
  persist();
  return rec;
}

export function listPayoutsByAgent(agentId: string): PayoutRecord[] {
  return load()
    .filter((p) => p.agentId === agentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listAllPayouts(): PayoutRecord[] {
  return load();
}

/** Persist any in-place mutations (e.g. admin status transitions). */
export function persistPayouts(): void {
  persist();
}

/**
 * Task 6.3 — auto-payout policy: for every seller whose internal balance is
 * at/above the threshold and who has opted into auto-payout (payoutMethod
 * set), create a payout request and debit the ledger — operator then runs
 * the existing admin approval flow. Idempotent: sellers with an open
 * (requested/approved) payout are skipped, so running repeatedly never
 * double-pays. dryRun returns the plan without mutating anything.
 */
export function schedulePayouts(opts?: {
  threshold?: number;
  dryRun?: boolean;
}): {
  created: PayoutRecord[];
  skippedNoOptIn: string[];
  skippedOpenPayout: string[];
  threshold: number;
} {
  const threshold =
    opts?.threshold ?? Number(process.env.AUTO_PAYOUT_THRESHOLD || 50);
  const created: PayoutRecord[] = [];
  const skippedNoOptIn: string[] = [];
  const skippedOpenPayout: string[] = [];

  const openStatuses = new Set<PayoutRecord["status"]>(["requested", "approved"]);

  for (const agent of db.listAgents()) {
    const balance = getBalance(agent);
    if (balance < threshold - 1e-12) continue;

    const method = agent.payoutMethod;
    if (!method) {
      skippedNoOptIn.push(agent.id);
      continue;
    }
    const account = agent.payoutAccount ?? null;

    const existing = load().find(
      (p) => p.agentId === agent.id && openStatuses.has(p.status)
    );
    if (existing) {
      skippedOpenPayout.push(agent.id);
      continue;
    }

    if (opts?.dryRun) {
      created.push({
        id: "dry",
        agentId: agent.id,
        amount: balance,
        method,
        account,
        status: "requested",
        createdAt: new Date().toISOString(),
      });
      continue;
    }

    // Create the payout request first (debit only after persist succeeds).
    const rec = addPayout({
      agentId: agent.id,
      amount: balance,
      method,
      account,
    });
    const debited = debitAgent(agent.id, balance, `auto_payout:${rec.id}`);
    if (!debited.ok) {
      // Ledger changed between check and debit (rare race) — roll back the
      // just-created record so the next run can retry cleanly.
      const idx = load().findIndex((p) => p.id === rec.id);
      if (idx >= 0) load().splice(idx, 1);
      persist();
      skippedNoOptIn.push(agent.id);
      continue;
    }
    created.push(rec);
  }

  return { created, skippedNoOptIn, skippedOpenPayout, threshold };
}
