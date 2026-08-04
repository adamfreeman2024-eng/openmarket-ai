/**
 * Payout store — seller withdrawal requests.
 * Persistence: in-memory + JSON file (data/payouts.json), tmp+rename atomic.
 */
import fs from "fs";
import path from "path";
import { newId } from "./store";

export type PayoutMethod = "hbar" | "usdc" | "manual";

export type PayoutRecord = {
  id: string;
  agentId: string;
  amount: number;
  method: PayoutMethod;
  account: string | null;
  status: "requested" | "approved" | "paid" | "rejected";
  adminNote?: string;
  createdAt: string;
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
}): PayoutRecord {
  const rec: PayoutRecord = {
    id: newId("pout"),
    agentId: input.agentId,
    amount: input.amount,
    method: input.method,
    account: input.account,
    status: "requested",
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
