/**
 * Auto-payout tests — Task 6.3:
 * schedulePayouts() creates payout requests + debits the ledger for sellers
 * at/above threshold who opted in; idempotent (open payout → skipped);
 * dryRun never mutates; admin run route enforces ADMIN_API_KEY.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";

let tmpDir: string;

// USDC live for any route that asserts assets.
vi.hoisted(() => {
  process.env.USDC_TOKEN_ID = "0.0.1234567";
});

const mocks = vi.hoisted(() => ({
  onChainRelease: vi.fn(),
  hashScanUrl: vi.fn(),
}));

vi.mock("@/lib/onchain-escrow-live", () => mocks);
vi.mock("@/lib/tx-id", () => ({
  normalizeTxId: (s: string) => s,
}));

function agent(
  id: string,
  key: string,
  opts: { balance?: number; payoutMethod?: string; payoutAccount?: string } = {}
) {
  return {
    id,
    name: `AP ${id}`,
    apiKey: key,
    walletAccountId: "0.0.9201",
    capabilities: ["demo.echo"],
    policy: {
      dailySpendLimit: 100,
      maxPerTx: 50,
      allowedCounterparties: [],
      allowedHours: [],
      velocityPerMinute: 0,
      spentToday: 0,
      spentDay: "2026-08-07",
      spentAt: [],
    },
    stats: { sales: 0, purchases: 0, success: 0, fail: 0, totalLatencyMs: 0 },
    verificationStatus: "bronze" as const,
    internalBalance: opts.balance ?? 0,
    payoutMethod: opts.payoutMethod as "hbar" | "usdc" | "manual" | undefined,
    payoutAccount: opts.payoutAccount,
    createdAt: "2026-08-07T00:00:00.000Z",
  };
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-payout-test-"));
  process.env.OM_DATA_DIR = tmpDir;
  process.env.ESCROW_CONTRACT_ADDRESS = "";
  process.env.STRICT_SETTLEMENT = "false";
  process.env.ADMIN_API_KEY = "omk_admin_payout_test";
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.onChainRelease.mockReset();
  mocks.onChainRelease.mockResolvedValue({ ok: false, error: "no contract" });
  mocks.hashScanUrl.mockReset();
});

describe("schedulePayouts (Task 6.3)", () => {
  it("creates a payout and debits the ledger for an opted-in seller ≥ threshold", async () => {
    const { db } = await import("../lib/store");
    db.putAgent(agent("agt_ap_1", "k_ap_1", { balance: 100, payoutMethod: "hbar", payoutAccount: "0.0.9201" }));

    const { schedulePayouts } = await import("../lib/payouts");
    const res = schedulePayouts({ threshold: 50 });

    expect(res.created).toHaveLength(1);
    expect(res.created[0].agentId).toBe("agt_ap_1");
    expect(res.created[0].amount).toBe(100);
    expect(res.created[0].status).toBe("requested");
    expect(db.getAgent("agt_ap_1")?.internalBalance).toBe(0); // debited
  });

  it("skips sellers below threshold", async () => {
    const { db } = await import("../lib/store");
    db.putAgent(agent("agt_ap_low", "k_ap_low", { balance: 49.99, payoutMethod: "usdc", payoutAccount: "0.0.1" }));

    const { schedulePayouts } = await import("../lib/payouts");
    const res = schedulePayouts({ threshold: 50 });

    expect(res.created).toHaveLength(0);
    expect(res.skippedNoOptIn).not.toContain("agt_ap_low"); // below threshold, not opt-in skip
    expect(db.getAgent("agt_ap_low")?.internalBalance).toBeCloseTo(49.99, 6);
  });

  it("skips sellers without payoutMethod opt-in", async () => {
    const { db } = await import("../lib/store");
    db.putAgent(agent("agt_ap_noopt", "k_ap_noopt", { balance: 200 }));

    const { schedulePayouts } = await import("../lib/payouts");
    const res = schedulePayouts({ threshold: 50 });

    expect(res.created).toHaveLength(0);
    expect(res.skippedNoOptIn).toContain("agt_ap_noopt");
    expect(db.getAgent("agt_ap_noopt")?.internalBalance).toBe(200);
  });

  it("is idempotent — open payout blocks a second request", async () => {
    const { db } = await import("../lib/store");
    const { schedulePayouts } = await import("../lib/payouts");

    // agt_ap_1 already has a requested payout from the first test (balance now 0).
    const res2 = schedulePayouts({ threshold: 50 });
    expect(res2.created).toHaveLength(0);

    // A fresh seller with an existing open payout is also skipped.
    db.putAgent(agent("agt_ap_dup", "k_ap_dup", { balance: 500, payoutMethod: "manual" }));
    const { addPayout } = await import("../lib/payouts");
    addPayout({ agentId: "agt_ap_dup", amount: 500, method: "manual", account: null });
    const res3 = schedulePayouts({ threshold: 50 });
    expect(res3.skippedOpenPayout).toContain("agt_ap_dup");
    expect(res3.created).toHaveLength(0);
    expect(db.getAgent("agt_ap_dup")?.internalBalance).toBe(500); // untouched
  });

  it("dryRun previews without creating records or debiting", async () => {
    const { db } = await import("../lib/store");
    db.putAgent(agent("agt_ap_dry", "k_ap_dry", { balance: 300, payoutMethod: "usdc", payoutAccount: "0.0.55" }));

    const { schedulePayouts, listAllPayouts } = await import("../lib/payouts");
    const res = schedulePayouts({ threshold: 50, dryRun: true });

    expect(res.created).toHaveLength(1);
    expect(res.created[0].id).toBe("dry");
    expect(db.getAgent("agt_ap_dry")?.internalBalance).toBe(300); // not debited
    expect(listAllPayouts().some((p) => p.agentId === "agt_ap_dry")).toBe(false); // not persisted
  });
});

describe("POST /api/v1/admin/payouts/run", () => {
  function req(key?: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (key) headers["x-api-key"] = key;
    if (body !== undefined) headers["content-type"] = "application/json";
    return new NextRequest("https://agentbazaar.app/api/v1/admin/payouts/run", {
      method: "POST",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  it("rejects non-admin keys (403)", async () => {
    const { POST } = await import("../app/api/v1/admin/payouts/run/route");
    const res = await POST(req("omk_wrong_key", { threshold: 50 }));
    expect(res.status).toBe(403);
  });

  it("runs the sweep for admin and reports created + skips", async () => {
    const { db } = await import("../lib/store");
    db.putAgent(agent("agt_ap_route", "k_ap_route", { balance: 80, payoutMethod: "hbar", payoutAccount: "0.0.9202" }));

    const { POST } = await import("../app/api/v1/admin/payouts/run/route");
    const res = await POST(req("omk_admin_payout_test", { threshold: 50 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.created).toBeGreaterThanOrEqual(1);
    const mine = body.payouts.find((p: { agentId: string }) => p.agentId === "agt_ap_route");
    expect(mine).toBeDefined();
    expect(mine.amount).toBe(80);
    expect(db.getAgent("agt_ap_route")?.internalBalance).toBe(0);
  });

  it("dryRun route returns wouldPay without mutating", async () => {
    const { db } = await import("../lib/store");
    db.putAgent(agent("agt_ap_route2", "k_ap_route2", { balance: 120, payoutMethod: "usdc", payoutAccount: "0.0.77" }));

    const { POST } = await import("../app/api/v1/admin/payouts/run/route");
    const res = await POST(req("omk_admin_payout_test", { threshold: 50, dryRun: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.wouldPay).toBeDefined();
    expect(body.wouldPay.some((p: { agentId: string }) => p.agentId === "agt_ap_route2")).toBe(true);
    expect(db.getAgent("agt_ap_route2")?.internalBalance).toBe(120); // untouched
  });
});

describe("PATCH /api/v1/agents/me — auto-payout opt-in (Task 6.3)", () => {
  function req(key?: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (key) headers["x-api-key"] = key;
    if (body !== undefined) headers["content-type"] = "application/json";
    return new NextRequest("https://agentbazaar.app/api/v1/agents/me", {
      method: "PATCH",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  it("persists payoutMethod + payoutAccount and returns them in GET", async () => {
    const { db } = await import("../lib/store");
    db.putAgent(agent("agt_ap_optin", "k_ap_optin", { balance: 10 }));

    const { PATCH, GET } = await import("../app/api/v1/agents/me/route");
    const res = await PATCH(req("k_ap_optin", { payoutMethod: "hbar", payoutAccount: "0.0.9201" }));
    expect(res.status).toBe(200);

    const stored = db.getAgent("agt_ap_optin");
    expect(stored?.payoutMethod).toBe("hbar");
    expect(stored?.payoutAccount).toBe("0.0.9201");

    const gres = await GET(req("k_ap_optin"));
    const gbody = await gres.json();
    expect(gbody.agent.payoutMethod).toBe("hbar");
    expect(gbody.agent.payoutAccount).toBe("0.0.9201");
  });

  it("allows opting out by setting payoutMethod to null", async () => {
    const { db } = await import("../lib/store");
    db.putAgent(agent("agt_ap_optout", "k_ap_optout", { balance: 10, payoutMethod: "usdc", payoutAccount: "0.0.1" }));

    const { PATCH } = await import("../app/api/v1/agents/me/route");
    const res = await PATCH(req("k_ap_optout", { payoutMethod: null, payoutAccount: null }));
    expect(res.status).toBe(200);
    expect(db.getAgent("agt_ap_optout")?.payoutMethod).toBeUndefined();
    expect(db.getAgent("agt_ap_optout")?.payoutAccount).toBeUndefined();
  });

  it("rejects invalid payoutMethod", async () => {
    const { db } = await import("../lib/store");
    db.putAgent(agent("agt_ap_bad", "k_ap_bad", { balance: 10 }));
    const { PATCH } = await import("../app/api/v1/agents/me/route");
    const res = await PATCH(req("k_ap_bad", { payoutMethod: "wire" }));
    expect(res.status).toBe(400);
  });
});
