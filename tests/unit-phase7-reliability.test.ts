/**
 * Phase 7.1 webhook health + ranking demotion
 * Phase 7.2 llm metrics
 * Phase 7.3 partial dispute split
 */
import { describe, it, expect, beforeEach } from "vitest";
import { rankOffer } from "../lib/ranking";
import type { OfferRecord, AgentRecord } from "../lib/types";
import { recordLlmFulfill, llmMetricsSnapshot } from "../lib/llm-metrics";
import { deriveHealthUrl } from "../lib/webhook-health";

function seller(partial: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agt_s",
    apiKey: "omk_x",
    name: "S",
    walletAccountId: "0.0.1",
    capabilities: ["demo.echo"],
    policy: {
      dailySpendLimit: 100,
      maxPerTx: 10,
      allowedCounterparties: [],
      allowedHours: [],
      velocityPerMinute: 0,
      spentToday: 0,
      spentDay: "2026-08-08",
      spentAt: [],
    },
    stats: { sales: 0, purchases: 0, success: 0, fail: 0, totalLatencyMs: 0 },
    createdAt: "2026-08-08T00:00:00.000Z",
    ...partial,
  };
}

function offer(partial: Partial<OfferRecord> = {}): OfferRecord {
  return {
    id: "off_1",
    agentId: "agt_s",
    capability: "demo.echo",
    title: "Echo",
    priceAmount: 1,
    priceAsset: "USDC",
    fulfillmentType: "webhook",
    webhookUrl: "http://187.55.228.127:3014/webhook",
    maxSeconds: 30,
    escrow: false,
    tags: [],
    active: true,
    createdAt: "2026-08-08T00:00:00.000Z",
    ...partial,
  };
}

describe("webhook health helpers", () => {
  it("deriveHealthUrl maps /webhook → /health", () => {
    expect(deriveHealthUrl("http://187.55.228.127:3014/webhook")).toBe(
      "http://187.55.228.127:3014/health"
    );
  });
});

describe("ranking webhookHealthy + escrow boost", () => {
  it("demotes unhealthy webhook sellers", () => {
    const o = offer();
    const s = seller({ stats: { sales: 5, purchases: 0, success: 5, fail: 0, totalLatencyMs: 1000 } });
    const healthy = rankOffer(o, s, { webhookHealthy: true });
    const unhealthy = rankOffer(o, s, { webhookHealthy: false });
    expect(unhealthy).toBeLessThan(healthy - 0.3);
  });

  it("boosts escrow offers slightly", () => {
    const s = seller();
    const plain = rankOffer(offer({ escrow: false, webhookUrl: undefined, fulfillmentType: "inline" }), s);
    const esc = rankOffer(offer({ escrow: true, webhookUrl: undefined, fulfillmentType: "inline" }), s);
    expect(esc).toBeGreaterThan(plain);
  });
});

describe("llm metrics", () => {
  it("records ok and err counters", () => {
    const before = llmMetricsSnapshot().fulfillTotal;
    recordLlmFulfill({ provider: "test-prov", ok: true, latencyMs: 12 });
    recordLlmFulfill({ provider: "test-prov", ok: false, latencyMs: 5, error: "x" });
    const snap = llmMetricsSnapshot();
    expect(snap.fulfillTotal).toBeGreaterThanOrEqual(before + 2);
    expect(snap.byProvider["test-prov"].ok).toBeGreaterThanOrEqual(1);
    expect(snap.byProvider["test-prov"].err).toBeGreaterThanOrEqual(1);
  });
});
