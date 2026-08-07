/**
 * Fiat on-ramp scaffold tests — Task 6.4:
 * GET/POST /api/v1/deposit/fiat report NOT_CONFIGURED (501) until provider
 * creds exist; when configured, POST returns a scaffold intent; config GET
 * exposes booleans only (never secrets).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";

let tmpDir: string;

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

const AGENT_KEY = "omk_fiat_test";

function req(key?: string, body?: unknown, url = "https://agentbazaar.app/api/v1/deposit/fiat") {
  const headers: Record<string, string> = {};
  if (key) headers["x-api-key"] = key;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(url, {
    method: body !== undefined ? "POST" : "GET",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fiat-test-"));
  process.env.OM_DATA_DIR = tmpDir;
  process.env.ESCROW_CONTRACT_ADDRESS = "";
  process.env.STRICT_SETTLEMENT = "false";
  // Ensure a clean slate: no fiat provider creds.
  delete process.env.FIAT_PROVIDER;
  delete process.env.FIAT_STRIPE_SECRET_KEY;
  delete process.env.FIAT_STRIPE_WEBHOOK_SECRET;
  const { db } = await import("../lib/store");
  db.putAgent({
    id: "agt_fiat",
    name: "Fiat Buyer",
    apiKey: AGENT_KEY,
    walletAccountId: "0.0.9301",
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

describe("fiat on-ramp NOT_CONFIGURED path (Task 6.4)", () => {
  it("GET reports configured:false without provider creds", async () => {
    const { GET } = await import("../app/api/v1/deposit/fiat/route");
    const res = await GET(req(AGENT_KEY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.configured).toBe(false);
    expect(body.creds.stripe).toBe(false);
    expect(body.creds.unlimit).toBe(false);
    expect(body.creds.idram).toBe(false);
  });

  it("POST returns 501 NOT_CONFIGURED with setup instructions", async () => {
    const { POST } = await import("../app/api/v1/deposit/fiat/route");
    const res = await POST(req(AGENT_KEY, { amount: 50, currency: "USD" }));
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.code).toBe("NOT_CONFIGURED");
    expect(body.error).toContain("FIAT_PROVIDER");
  });

  it("POST without auth key is rejected", async () => {
    const { POST } = await import("../app/api/v1/deposit/fiat/route");
    const res = await POST(req(undefined, { amount: 50 }));
    expect([400, 401, 403]).toContain(res.status);
  });
});

describe("fiat on-ramp configured path (scaffold intent)", () => {
  it("POST returns a scaffold intent when stripe creds are set", async () => {
    process.env.FIAT_PROVIDER = "stripe";
    process.env.FIAT_STRIPE_SECRET_KEY = "sk_test_scaffold";
    process.env.FIAT_STRIPE_WEBHOOK_SECRET = "whsec_scaffold";
    // Config is read per-call (getFiatConfig), so no import restart needed.

    const { POST, GET } = await import("../app/api/v1/deposit/fiat/route");
    const gres = await GET(req(AGENT_KEY));
    const gbody = await gres.json();
    expect(gbody.configured).toBe(true);
    expect(gbody.provider).toBe("stripe");

    const res = await POST(req(AGENT_KEY, { amount: 25, currency: "USD" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.intent.provider).toBe("stripe");
    expect(body.intent.amount).toBe(25);
    expect(body.intent.currency).toBe("USD");
    expect(body.intent.status).toBe("created");
    // No secrets ever leak
    expect(JSON.stringify(body)).not.toContain("sk_test_scaffold");

    delete process.env.FIAT_PROVIDER;
    delete process.env.FIAT_STRIPE_SECRET_KEY;
    delete process.env.FIAT_STRIPE_WEBHOOK_SECRET;
  });
});

describe("lib/payments/fiat config", () => {
  it("getFiatConfig detects idram creds only when provider matches", async () => {
    process.env.FIAT_PROVIDER = "idram";
    process.env.FIAT_IDRAM_MERCHANT_ID = "merchant_1";
    process.env.FIAT_IDRAM_SECRET = "sec_1";
    const { getFiatConfig, isFiatConfigured } = await import("../lib/payments/fiat");
    const cfg = getFiatConfig();
    expect(cfg.configured).toBe(true);
    expect(cfg.configuredProvider).toBe("idram");
    expect(isFiatConfigured()).toBe(true);

    // Wrong provider for these creds => not configured.
    process.env.FIAT_PROVIDER = "stripe";
    expect(getFiatConfig().configured).toBe(false);

    delete process.env.FIAT_PROVIDER;
    delete process.env.FIAT_IDRAM_MERCHANT_ID;
    delete process.env.FIAT_IDRAM_SECRET;
  });

  it("createFiatPayment throws NOT_CONFIGURED without creds", async () => {
    const { createFiatPayment } = await import("../lib/payments/fiat");
    await expect(
      createFiatPayment({ amount: 10, agentId: "agt_fiat" })
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});
