/**
 * Seller ledger tests — Phase 1.1 financial transparency:
 * seller internalBalance is credited on BOTH escrow release and
 * non-escrow (inline/LLM) completion, with the SELLER AMOUNT
 * (total − platform fee), never the full total.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";

let tmpDir: string;

const mocks = vi.hoisted(() => ({
  onChainRelease: vi.fn(),
  hashScanUrl: vi.fn(),
}));

vi.mock("@/lib/onchain-escrow-live", () => mocks);

// Mock settlement so the pay-route integration test never hits the mirror.
vi.mock("@/lib/settlement", () => ({
  verifyPayment: vi.fn(async () => ({ ok: true, mode: "test_unit" })),
  fulfillOffer: vi.fn(async () => ({ ok: true, echo: "test" })),
  createEscrowForOrder: vi.fn(),
}));

// store.ts lazily require()s ./tx-id inside claimTxUsed — give vitest a stub.
vi.mock("@/lib/tx-id", () => ({
  normalizeTxId: (s: string) => s,
}));

const SELLER_KEY = "omk_seller-ledger-test";
const BUYER_KEY = "omk_buyer-ledger-test";

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

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seller-ledger-test-"));
  process.env.OM_DATA_DIR = tmpDir;
  process.env.ESCROW_CONTRACT_ADDRESS = "";
  process.env.STRICT_SETTLEMENT = "false";
  const { db } = await import("../lib/store");
  db.putAgent({
    id: "agt_seller",
    name: "Ledger Seller",
    apiKey: SELLER_KEY,
    walletAccountId: "0.0.9001",
    capabilities: ["text.translate"],
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
    verificationStatus: "bronze",
    createdAt: "2026-08-07T00:00:00.000Z",
  });
  db.putAgent({
    id: "agt_buyer",
    name: "Ledger Buyer",
    apiKey: BUYER_KEY,
    walletAccountId: "0.0.9002",
    capabilities: ["buyer"],
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
    verificationStatus: "bronze",
    createdAt: "2026-08-07T00:00:00.000Z",
  });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.onChainRelease.mockReset();
  mocks.onChainRelease.mockResolvedValue({ ok: false, error: "no contract" });
  mocks.hashScanUrl.mockReset();
});

function makeOrder(id: string, totalAmount: number, platformFee: number) {
  return {
    id,
    quoteId: `qte_${id}`,
    offerId: `off_${id}`,
    sellerAgentId: "agt_seller",
    buyerAgentId: "agt_buyer",
    buyerWallet: "0.0.9002",
    totalAmount,
    platformFee,
    priceAsset: "USDC" as const,
    status: "paid" as const,
    transactionId: `0.0.9002@123.${id}`,
    createdAt: "2026-08-07T10:00:00.000Z",
  };
}

describe("escrow release credits seller amount (total − fee)", () => {
  it("credits internalBalance with sellerAmount and marks order completed", async () => {
    const { db } = await import("../lib/store");
    const order = makeOrder("ord_rel1", 2.04, 0.04);
    db.putOrder(order);
    db.putEscrow({
      id: "esc_rel1",
      orderId: "ord_rel1",
      status: "locked",
      amount: 2.04,
      asset: "USDC",
      buyerWallet: "0.0.9002",
      sellerAgentId: "agt_seller",
      expiresAt: "2026-08-10T10:00:00.000Z",
      createdAt: "2026-08-07T10:00:00.000Z",
      updatedAt: "2026-08-07T10:00:00.000Z",
    });

    const { POST } = await import("../app/api/v1/escrow/[id]/release/route");
    const res = await POST(req("https://agentbazaar.app/api/v1/escrow/esc_rel1/release", {
      method: "POST",
      key: SELLER_KEY,
      body: { proof: "delivered-ok" },
    }), params("esc_rel1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.escrow.status).toBe("released");
    expect(body.order.status).toBe("completed");
    expect(body.order.sellerAmount).toBeCloseTo(2.0, 6); // total − fee on the order

    const seller = db.getAgent("agt_seller");
    expect(seller?.internalBalance).toBeCloseTo(2.0, 6); // 2.04 − 0.04 fee
  });

  it("rejects release when escrow is not locked (replay guard)", async () => {
    const { db } = await import("../lib/store");
    db.putEscrow({
      id: "esc_replay",
      orderId: "ord_rel1",
      status: "released",
      amount: 1,
      asset: "USDC",
      sellerAgentId: "agt_seller",
      expiresAt: "2026-08-10T10:00:00.000Z",
      createdAt: "2026-08-07T10:00:00.000Z",
      updatedAt: "2026-08-07T10:00:00.000Z",
    });

    const { POST } = await import("../app/api/v1/escrow/[id]/release/route");
    const res = await POST(req("https://agentbazaar.app/api/v1/escrow/esc_replay/release", {
      method: "POST",
      key: SELLER_KEY,
      body: { proof: "x" },
    }), params("esc_replay"));

    expect(res.status).toBe(409);
  });
});

describe("agent-ledger helpers", () => {
  it("creditSale credits the exact seller amount", async () => {
    const { db } = await import("../lib/store");
    const { creditSale, getBalance } = await import("../lib/agent-ledger");
    db.putAgent({
      id: "agt_seller2",
      name: "Ledger Seller 2",
      apiKey: "omk_seller-ledger-test-2",
      walletAccountId: "0.0.9003",
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
      verificationStatus: "bronze",
      createdAt: "2026-08-07T00:00:00.000Z",
    });
    const updated = creditSale("agt_seller2", 0.5, "ord_x");
    expect(getBalance(updated!)).toBe(0.5);
  });

  it("debitAgent fails on insufficient balance", async () => {
    const { debitAgent } = await import("../lib/agent-ledger");
    const res = debitAgent("agt_seller2", 999, "test");
    expect(res.ok).toBe(false);
  });
});

describe("non-escrow pay credits seller (inline/LLM completion)", () => {
  it("credits internalBalance with sellerAmount after fulfill", async () => {
    const { db } = await import("../lib/store");
    // Non-escrow offer + quote + awaiting_payment order
    db.putOffer({
      id: "off_echo_pay",
      agentId: "agt_seller",
      capability: "demo.echo",
      title: "Echo",
      priceAmount: 0.5,
      priceAsset: "USDC",
      fulfillmentType: "inline",
      maxSeconds: 10,
      escrow: false,
      tags: [],
      active: true,
      createdAt: "2026-08-07T00:00:00.000Z",
    });
    db.putQuote({
      id: "qte_ord_echo_pay",
      offerId: "off_echo_pay",
      agentId: "agt_seller",
      buyerAgentId: "agt_buyer",
      buyerWallet: "0.0.9002",
      priceAmount: 0.5,
      platformFee: 0.01,
      totalAmount: 0.51,
      priceAsset: "USDC",
      payTo: "0.0.9587214",
      expiresAt: "2026-08-07T11:00:00.000Z",
      createdAt: "2026-08-07T10:00:00.000Z",
    });
    db.putOrder({
      ...makeOrder("ord_echo_pay", 0.51, 0.01),
      status: "awaiting_payment",
    });

    const { POST } = await import("../app/api/v1/orders/[id]/pay/route");
    const res = await POST(
      req("https://agentbazaar.app/api/v1/orders/ord_echo_pay/pay", {
        method: "POST",
        key: BUYER_KEY,
        // no transactionId: verifyPayment is mocked ok; avoids store claimTxUsed require
        body: { devFakePay: true },
      }),
      params("ord_echo_pay")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order.status).toBe("completed");

    const seller = db.getAgent("agt_seller");
    // seller already got 2.0 from the escrow-release test; echo adds 0.50
    expect(seller?.internalBalance).toBeCloseTo(2.5, 6);
  });
});

describe("buy with internal balance (Phase 2.1)", () => {
  it("debits buyer balance and completes without an on-chain tx", async () => {
    const { db } = await import("../lib/store");
    // Fresh seller so this test doesn't perturb the shared agt_seller balance.
    db.putAgent({
      id: "agt_seller_ibuy",
      name: "IBuy Seller",
      apiKey: "omk_ibuy-seller",
      walletAccountId: "0.0.9005",
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
      verificationStatus: "bronze",
      createdAt: "2026-08-07T00:00:00.000Z",
    });
    // Give the buyer a starting balance to spend (direct put — no async hydrate race).
    const buyer = db.getAgent("agt_buyer");
    db.putAgent({ ...buyer!, internalBalance: 10 });

    db.putOffer({
      id: "off_ibuy",
      agentId: "agt_seller_ibuy",
      capability: "demo.echo",
      title: "Echo internal-balance",
      priceAmount: 0.5,
      priceAsset: "USDC",
      fulfillmentType: "inline",
      maxSeconds: 10,
      escrow: false,
      tags: [],
      active: true,
      createdAt: "2026-08-07T00:00:00.000Z",
    });
    db.putQuote({
      id: "qte_ibuy",
      offerId: "off_ibuy",
      agentId: "agt_seller_ibuy",
      buyerAgentId: "agt_buyer",
      buyerWallet: "0.0.9002",
      priceAmount: 0.5,
      platformFee: 0.01,
      totalAmount: 0.51,
      priceAsset: "USDC",
      payTo: "0.0.9587214",
      expiresAt: "2026-08-07T11:00:00.000Z",
      createdAt: "2026-08-07T10:00:00.000Z",
    });

    const { POST } = await import("../app/api/v1/buy/route");
    const res = await POST(
      req("https://agentbazaar.app/api/v1/buy", {
        method: "POST",
        key: BUYER_KEY,
        body: { offerId: "off_ibuy", input: { text: "buy with balance" } },
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.order.status).toBe("completed");
    expect(body.order.transactionId).toContain("internal:");

    const buyerAfter = db.getAgent("agt_buyer");
    // 10 topup − 0.51 spent = 9.49
    expect(buyerAfter?.internalBalance).toBeCloseTo(9.49, 6);
    // Seller earned 0.50 (0.51 − 0.01 fee)
    expect(db.getAgent("agt_seller_ibuy")?.internalBalance).toBeCloseTo(0.5, 6);
  });
});

describe("deposit on-chain verification (Task 2.2)", () => {
  it("rejects deposit without txId in strict mode (402)", async () => {
    // ALLOW_DEV_FAKE_SETTLEMENT is false in this environment → mainnet path.
    const { POST } = await import("../app/api/v1/deposit/route");
    const res = await POST(
      req("https://agentbazaar.app/api/v1/deposit", {
        method: "POST",
        key: BUYER_KEY,
        body: { amount: 5, asset: "usdc" },
      })
    );
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("MAINNET_DEPOSIT_REQUIRES_TX");
  });

  it("credits balance after mirror-verified deposit", async () => {
    // settlement.verifyPayment is mocked to {ok:true} in this suite.
    const { POST } = await import("../app/api/v1/deposit/route");
    const res = await POST(
      req("https://agentbazaar.app/api/v1/deposit", {
        method: "POST",
        key: BUYER_KEY,
        body: { amount: 5, asset: "usdc", txId: "0.0.9002@1786.456" },
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.mode).toBe("mirror_verified");
    expect(body.balance).toBeCloseTo(14.49, 4); // 9.49 (prev test) + 5
  });
});

describe("GET /api/v1/me — financial transparency (Task 1.2)", () => {
  it("exposes balance, earnedTotal (net) and sellerAmount on sell orders", async () => {
    const { GET } = await import("../app/api/v1/me/route");
    const res = await GET(
      req("https://agentbazaar.app/api/v1/me", { key: SELLER_KEY })
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // Seller balance — 2.0 (escrow release) + 0.50 (inline pay)
    expect(body.agent.internalBalance).toBeCloseTo(2.5, 6);

    // Earned = seller net after platform fee, across completed sales
    expect(body.revenue.earnedTotal).toBeCloseTo(2.5, 6);
    expect(body.revenue.netByAsset.USDC).toBeCloseTo(2.5, 6);
    // Gross revenue counts the full total paid by buyers
    expect(body.revenue.byAsset.USDC).toBeCloseTo(2.55, 6);

    // Recent sell orders carry sellerAmount (= total − fee) on each record
    const sellOrders = body.recentSellOrders as Array<{
      id: string;
      sellerAmount?: number;
    }>;
    expect(sellOrders.length).toBeGreaterThanOrEqual(2);
    const sellerAmounts = sellOrders
      .filter((o) => typeof o.sellerAmount === "number")
      .map((o) => o.sellerAmount as number);
    const totalNet = Number(
      sellerAmounts.reduce((s, a) => s + a, 0).toFixed(6)
    );
    expect(totalNet).toBeCloseTo(2.5, 6);
  });
});

describe("auto-hire (Phase 6.1)", () => {
  it("finds best non-escrow offer, pays from internal balance, completes", async () => {
    const { db } = await import("../lib/store");
    // Isolated seller so shared agt_seller expectations (2.5) stay intact.
    db.putAgent({
      id: "agt_ah_seller",
      name: "AutoHire Seller",
      apiKey: "omk_ah-seller",
      walletAccountId: "0.0.9011",
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
      verificationStatus: "bronze",
      createdAt: "2026-08-07T00:00:00.000Z",
    });
    db.putOffer({
      id: "off_ah",
      agentId: "agt_ah_seller",
      capability: "demo.echo.ah",
      title: "Echo auto-hire",
      description: "fast echo",
      priceAmount: 1.0,
      priceAsset: "USDC",
      fulfillmentType: "inline",
      maxSeconds: 10,
      escrow: false,
      tags: ["echo"],
      active: true,
      createdAt: "2026-08-07T00:00:00.000Z",
    });
    // Buyer funded 10 (direct put — no hydrate race).
    const buyer = db.getAgent("agt_buyer");
    db.putAgent({ ...buyer!, internalBalance: 10 });

    const { POST } = await import("../app/api/v1/auto-hire/route");
    const res = await POST(
      req("https://agentbazaar.app/api/v1/auto-hire", {
        method: "POST",
        key: BUYER_KEY,
        body: { capability: "demo.echo.ah", input: { text: "hi" } },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.offer.capability).toBe("demo.echo.ah");
    expect(body.seller.id).toBe("agt_ah_seller");
    // total = 1.00 price + 0.02 fee = 1.02
    expect(body.amount.total).toBeCloseTo(1.02, 6);
    // Buyer 10 → 8.98
    expect(body.balance).toBeCloseTo(8.98, 6);
    // Seller earned 1.00 (1.02 − 0.02)
    expect(db.getAgent("agt_ah_seller")?.internalBalance).toBeCloseTo(1.0, 6);
  });

  it("returns NO_MATCH when nothing offers the capability", async () => {
    const { POST } = await import("../app/api/v1/auto-hire/route");
    const res = await POST(
      req("https://agentbazaar.app/api/v1/auto-hire", {
        method: "POST",
        key: BUYER_KEY,
        body: { capability: "nonexistent.cap", input: {} },
      })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("NO_MATCH");
  });

  it("returns INSUFFICIENT_BALANCE with retry hint when balance too low", async () => {
    const { db } = await import("../lib/store");
    const buyer = db.getAgent("agt_buyer");
    db.putAgent({ ...buyer!, internalBalance: 0.01 });
    const { POST } = await import("../app/api/v1/auto-hire/route");
    const res = await POST(
      req("https://agentbazaar.app/api/v1/auto-hire", {
        method: "POST",
        key: BUYER_KEY,
        body: { capability: "demo.echo", input: {} },
      })
    );
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("INSUFFICIENT_BALANCE");
    expect(body.hint).toContain("deposit");
  });
});
