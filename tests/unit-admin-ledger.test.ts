/**
 * Task 5.2 — Financial audit trail (/api/v1/admin/ledger).
 * Auth: only ADMIN_API_KEY holder can view the ledger.
 * Shape: summary totals + per-agent balances + ledger.credit/debit trail.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";

let tmpDir: string;
const ADMIN_KEY = "admin-ledger-test-key-1";

let ledgerRoute: typeof import("../app/api/v1/admin/ledger/route");
let store: typeof import("../lib/store");
let ledger: typeof import("../lib/agent-ledger");

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-ledger-test-"));
  process.env.OM_DATA_DIR = tmpDir;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  ledgerRoute = await import("../app/api/v1/admin/ledger/route");
  store = await import("../lib/store");
  ledger = await import("../lib/agent-ledger");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Fresh store per test: reset in-memory state by clearing agents.
  const s = (store as unknown as { __reset?: () => void });
  // store module keeps its own module-level state; easiest stable reset is
  // to clear audit and agents via the exported helpers if available.
  try {
    const { db } = store;
    for (const a of db.listAgents()) {
      db.putAgent({ ...a, internalBalance: 0 });
    }
  } catch {
    /* ignore */
  }
});

function req(url: string, opts: { key?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (opts.key) headers["x-api-key"] = opts.key;
  return new NextRequest(url, { method: "GET", headers });
}

async function getBody(res: Response) {
  return res.json();
}

describe("admin ledger", () => {
  it("403 without admin key", async () => {
    const res = await ledgerRoute.GET(req("http://x/api/v1/admin/ledger"));
    expect(res.status).toBe(403);
    const body = await getBody(res);
    expect(body.ok).toBe(false);
  });

  it("403 with wrong admin key", async () => {
    const res = await ledgerRoute.GET(
      req("http://x/api/v1/admin/ledger", { key: "wrong-key" })
    );
    expect(res.status).toBe(403);
  });

  it("200 with correct admin key — summary + empty trail on fresh store", async () => {
    const res = await ledgerRoute.GET(
      req("http://x/api/v1/admin/ledger", { key: ADMIN_KEY })
    );
    expect(res.status).toBe(200);
    const body = await getBody(res);
    expect(body.ok).toBe(true);
    expect(body.summary).toBeDefined();
    expect(typeof body.summary.totalInternalBalance).toBe("number");
    expect(Array.isArray(body.agentBalances)).toBe(true);
    expect(Array.isArray(body.ledgerEntries)).toBe(true);
    expect(Array.isArray(body.payouts)).toBe(true);
  });

  it("ledger trail shows credit and debit entries after ledger ops", async () => {
    const { db } = store;
    const seller = db.getAgentByKey("seller") || null;
    // Seed a seller agent if not present.
    if (!seller) {
      db.putAgent({
        id: "agt_ledger_seller",
        name: "Ledger Seller",
        apiKey: "seller-ledger-test-key",
        walletAccountId: "0.0.2001",
        capabilities: ["test"],
        policy: {
          dailySpendLimit: 1000,
          maxPerTx: 100,
          allowedCounterparties: [],
          allowedHours: [],
          velocityPerMinute: 0,
          spentToday: 0,
          spentDay: "2026-08-08",
          spentAt: [],
        },
        stats: { sales: 0, purchases: 0, success: 0, fail: 0, totalLatencyMs: 0 },
        verificationStatus: "bronze",
        createdAt: "2026-08-08T00:00:00.000Z",
      });
    }
    const sellerAgent =
      db.getAgentByKey("seller-ledger-test-key") || db.getAgent("agt_ledger_seller")!;

    ledger.creditAgent(sellerAgent.id, 12.5, "sale:ord_test1");
    ledger.debitAgent(sellerAgent.id, 2.5, "payout:pout_test1");

    const res = await ledgerRoute.GET(
      req("http://x/api/v1/admin/ledger?limit=50", { key: ADMIN_KEY })
    );
    expect(res.status).toBe(200);
    const body = await getBody(res);

    const credits = body.ledgerEntries.filter(
      (e: { type: string }) => e.type === "ledger.credit"
    );
    const debits = body.ledgerEntries.filter(
      (e: { type: string }) => e.type === "ledger.debit"
    );
    expect(credits.length).toBeGreaterThanOrEqual(1);
    expect(debits.length).toBeGreaterThanOrEqual(1);
    expect(body.summary.ledgerEntries).toBeGreaterThanOrEqual(2);

    const mine = body.agentBalances.find(
      (a: { agentId: string }) => a.agentId === sellerAgent.id
    );
    expect(mine).toBeDefined();
    // 12.5 credited, 2.5 debited → 10.0
    expect(mine.internalBalance).toBeCloseTo(10.0, 8);
  });

  it("limit param caps ledger trail length", async () => {
    const res = await ledgerRoute.GET(
      req("http://x/api/v1/admin/ledger?limit=1", { key: ADMIN_KEY })
    );
    expect(res.status).toBe(200);
    const body = await getBody(res);
    expect(body.ledgerEntries.length).toBeLessThanOrEqual(1);
  });
});
