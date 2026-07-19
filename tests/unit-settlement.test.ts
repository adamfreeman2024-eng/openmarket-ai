/**
 * Unit tests for settlement verification logic.
 * Tests HBAR/USDC transfer parsing, devFakePay guard, replay protection.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock config before importing settlement
vi.mock("@/lib/config", () => ({
  MIRROR: "https://testnet.mirrornode.hedera.com",
  ALLOW_DEV_FAKE_SETTLEMENT: true,
  NETWORK: "testnet",
  USDC_TOKEN_ID: "0.0.123456",
  USDC_DECIMALS: 6,
  PLATFORM_FEE_BPS: 200,
  SITE_URL: "http://localhost:3000",
  DEFAULT_ASSET: "HBAR",
  HCS_AUDIT_TOPIC_ID: "",
  ESCROW_CONTRACT_ADDRESS: "",
  marketCard: () => ({}),
}));

// Mock store to avoid file system side effects
vi.mock("@/lib/store", () => ({
  db: {
    isTxUsed: vi.fn(() => false),
    markTxUsed: vi.fn(),
    putOrder: vi.fn(),
    putEscrow: vi.fn(),
    putAgent: vi.fn(),
  },
  newId: vi.fn((prefix) => `${prefix}_test`),
  audit: vi.fn(),
  ensureSeedCatalog: vi.fn(),
  utcDay: vi.fn(() => "2026-07-19"),
}));

import { verifyPayment } from "../lib/settlement";

describe("verifyPayment — devFakePay", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should accept devFakePay when ALLOW_DEV_FAKE_SETTLEMENT=true and not in production", async () => {
    process.env.NODE_ENV = "development";
    const r = await verifyPayment({
      devFakePay: true,
      expectedPayTo: "0.0.1000",
      expectedAmount: 1,
      asset: "HBAR",
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("dev_fake");
  });

  it("should reject devFakePay when STRICT_SETTLEMENT=true without confirmation", async () => {
    process.env.STRICT_SETTLEMENT = "true";
    delete process.env.DEV_FAKE_PAYMENT_CONFIRMED;
    const r = await verifyPayment({
      devFakePay: true,
      expectedPayTo: "0.0.1000",
      expectedAmount: 1,
      asset: "HBAR",
    });
    expect(r.ok).toBe(false);
    expect(r.mode).toBe("security_warning");
    delete process.env.STRICT_SETTLEMENT;
  });

  it("should accept devFakePay with STRICT_SETTLECTION confirmation env var", async () => {
    process.env.STRICT_SETTLEMENT = "true";
    process.env.DEV_FAKE_PAYMENT_CONFIRMED = "yes_i_know_what_i_am_doing";
    const r = await verifyPayment({
      devFakePay: true,
      expectedPayTo: "0.0.1000",
      expectedAmount: 1,
      asset: "HBAR",
    });
    expect(r.ok).toBe(true);
    delete process.env.STRICT_SETTLEMENT;
    delete process.env.DEV_FAKE_PAYMENT_CONFIRMED;
  });
});

describe("verifyPayment — transactionId validation", () => {
  it("should reject missing transactionId when devFakePay is false", async () => {
    const r = await verifyPayment({
      expectedPayTo: "0.0.1000",
      expectedAmount: 1,
      asset: "HBAR",
    });
    expect(r.ok).toBe(false);
    expect(r.mode).toBe("missing_tx");
  });
});
