/**
 * SLA guarantee tests — Phase 6.2:
 * escrow-backed orders must expose a refund deadline to the buyer
 * BEFORE paying (quote + buy-402) and AT checkout (buy escrow success),
 * while non-escrow offers never claim a guarantee.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";

let tmpDir: string;

// USDC must be "live" for quote route's assertAssetLive — set before any
// config import evaluates (vi.hoisted runs before module imports).
vi.hoisted(() => {
  process.env.USDC_TOKEN_ID = "0.0.1234567";
});

const mocks = vi.hoisted(() => ({
  onChainRelease: vi.fn(),
  hashScanUrl: vi.fn(),
}));

vi.mock("@/lib/onchain-escrow-live", () => mocks);

// Keep the REAL createEscrowForOrder/expireEscrows but never hit the mirror.
vi.mock("@/lib/settlement", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    verifyPayment: vi.fn(async () => ({ ok: true, mode: "test_unit" })),
  };
});

// store.ts lazily require()s ./tx-id inside claimTxUsed — give vitest a stub.
vi.mock("@/lib/tx-id", () => ({
  normalizeTxId: (s: string) => s,
}));

const SELLER_KEY = "omk_sla_seller";
const BUYER_KEY = "omk_sla_buyer";

function req(
  url: string,
  opts: { method?: string; key?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (opts.key) headers["x-api-key"] = opts.key;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

function agent(id: string, key: string, wallet: string) {
  return {
    id,
    name: `SLA ${id}`,
    apiKey: key,
    walletAccountId: wallet,
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
    createdAt: "2026-08-07T00:00:00.000Z",
  };
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sla-guarantee-test-"));
  process.env.OM_DATA_DIR = tmpDir;
  process.env.ESCROW_CONTRACT_ADDRESS = "";
  process.env.STRICT_SETTLEMENT = "false";
  const { db } = await import("../lib/store");
  db.putAgent(agent("agt_sla_seller", SELLER_KEY, "0.0.9101"));
  db.putAgent(agent("agt_sla_buyer", BUYER_KEY, "0.0.9102"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.onChainRelease.mockReset();
  mocks.onChainRelease.mockResolvedValue({ ok: false, error: "no contract" });
  mocks.hashScanUrl.mockReset();
});

async function putOffer(id: string, escrow: boolean, price = 1.0) {
  const { db } = await import("../lib/store");
  db.putOffer({
    id,
    agentId: "agt_sla_seller",
    capability: `demo.sla.${escrow ? "esc" : "plain"}`,
    title: escrow ? "Escrow offer" : "Plain offer",
    description: "sla test",
    priceAmount: price,
    priceAsset: "USDC",
    fulfillmentType: "inline",
    maxSeconds: 10,
    escrow,
    tags: [],
    active: true,
    createdAt: "2026-08-07T00:00:00.000Z",
  });
}

describe("POST /api/v1/quotes — escrowDeadline surfaced before paying (Task 6.2)", () => {
  it("includes escrowDeadline (≈72h in future) for escrow offers", async () => {
    await putOffer("off_sla_esc_q", true);
    const { POST } = await import("../app/api/v1/quotes/route");
    const res = await POST(
      req("https://agentbazaar.app/api/v1/quotes", {
        method: "POST",
        key: BUYER_KEY,
        body: { offerId: "off_sla_esc_q" },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.escrowDeadline).toBeDefined();
    const deadline = new Date(body.escrowDeadline).getTime();
    const now = Date.now();
    // ~72h lock: allow build/test clock skew of a few minutes
    expect(deadline).toBeGreaterThan(now + 71 * 3600 * 1000);
    expect(deadline).toBeLessThan(now + 73 * 3600 * 1000);
  });

  it("omits escrowDeadline for non-escrow offers", async () => {
    await putOffer("off_sla_plain_q", false);
    const { POST } = await import("../app/api/v1/quotes/route");
    const res = await POST(
      req("https://agentbazaar.app/api/v1/quotes", {
        method: "POST",
        key: BUYER_KEY,
        body: { offerId: "off_sla_plain_q" },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.escrowDeadline).toBeUndefined();
  });
});

describe("POST /api/v1/buy — guarantee on PAYMENT_REQUIRED (escrow only)", () => {
  it("returns guarantee with deadline for escrow offers (buyer sees SLA before paying)", async () => {
    await putOffer("off_sla_esc_b", true);
    const { POST } = await import("../app/api/v1/buy/route");
    const res = await POST(
      req("https://agentbazaar.app/api/v1/buy", {
        method: "POST",
        key: BUYER_KEY,
        body: { offerId: "off_sla_esc_b", input: { text: "hi" } },
      })
    );
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("PAYMENT_REQUIRED");
    expect(body.guarantee).toBeDefined();
    expect(body.guarantee.escrow).toBe(true);
    expect(body.guarantee.message).toContain("automatically refunded");
    const deadline = new Date(body.guarantee.deadline).getTime();
    expect(deadline).toBeGreaterThan(Date.now() + 71 * 3600 * 1000);
  });

  it("has NO guarantee for non-escrow offers", async () => {
    await putOffer("off_sla_plain_b", false);
    const { POST } = await import("../app/api/v1/buy/route");
    const res = await POST(
      req("https://agentbazaar.app/api/v1/buy", {
        method: "POST",
        key: BUYER_KEY,
        body: { offerId: "off_sla_plain_b", input: { text: "hi" } },
      })
    );
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.guarantee).toBeUndefined();
  });

  it("escrow checkout success returns guarantee whose deadline matches escrow.expiresAt", async () => {
    const { db } = await import("../lib/store");
    await putOffer("off_sla_esc_ok", true);
    const { POST } = await import("../app/api/v1/buy/route");
    const res = await POST(
      req("https://agentbazaar.app/api/v1/buy", {
        method: "POST",
        key: BUYER_KEY,
        body: { offerId: "off_sla_esc_ok", input: { text: "hi" }, devFakePay: true },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.escrow.status).toBe("locked");
    expect(body.guarantee).toBeDefined();
    expect(body.guarantee.deadline).toBe(body.escrow.expiresAt);
    // Escrow record persisted with the same deadline
    const stored = db.getEscrow(body.escrow.id);
    expect(stored?.expiresAt).toBe(body.guarantee.deadline);
  });
});
