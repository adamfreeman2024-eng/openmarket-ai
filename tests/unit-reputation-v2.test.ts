import { describe, it, expect, beforeEach } from "vitest";
import {
  addReview,
  getReviewStats,
  computeSLA,
  computeReputationV2,
} from "../lib/reputation-v2";
import type { AgentRecord } from "../lib/types";

function makeAgent(id: string): AgentRecord {
  return {
    id,
    name: `Agent ${id}`,
    apiKey: "k",
    walletAccountId: "0.0.1",
    capabilities: ["text.translate"],
    policy: {
      dailySpendLimit: 10,
      maxPerTx: 5,
      allowedCounterparties: [],
      spentToday: 0,
      spentDay: "2026-08-03",
    },
    stats: { sales: 10, success: 9, fail: 1, totalLatencyMs: 9000 },
    createdAt: new Date().toISOString(),
  } as AgentRecord;
}

// Reset review store between tests by clearing via a fresh agent id
describe("Reputation V2 — reviews", () => {
  beforeEach(() => {
    // unique agent ids per test avoid cross-test contamination
  });

  it("adds a verified review", () => {
    const agentId = `seller-${Date.now()}-1`;
    const r = addReview({
      agentId,
      orderId: "o1",
      reviewerAgentId: "buyer1",
      rating: 5,
      comment: "Great work",
    });
    expect(r.flagged).toBe(false);
    expect(r.verified).toBe(true);
    const stats = getReviewStats(agentId);
    expect(stats.total).toBe(1);
    expect(stats.average).toBe(5);
  });

  it("flags self-reviews", () => {
    const agentId = `seller-${Date.now()}-2`;
    const r = addReview({
      agentId,
      orderId: "o1",
      reviewerAgentId: agentId, // self-review
      rating: 5,
      comment: "I'm great",
    });
    expect(r.flagged).toBe(true);
    expect(r.flagReason).toBe("SELF_REVIEW");
    // flagged reviews don't count towards stats
    expect(getReviewStats(agentId).total).toBe(0);
  });

  it("computes average across verified reviews only", () => {
    const agentId = `seller-${Date.now()}-3`;
    addReview({ agentId, orderId: "o1", reviewerAgentId: "b1", rating: 4, comment: "" });
    addReview({ agentId, orderId: "o2", reviewerAgentId: "b2", rating: 2, comment: "" });
    const stats = getReviewStats(agentId);
    expect(stats.total).toBe(2);
    expect(stats.average).toBe(3);
    expect(stats.distribution[4]).toBe(1);
    expect(stats.distribution[2]).toBe(1);
  });
});

describe("Reputation V2 — SLA", () => {
  it("returns neutral SLA when no completed orders", () => {
    const sla = computeSLA(makeAgent("a"), []);
    expect(sla.totalDeliveries).toBe(0);
    expect(sla.onTimeRate).toBe(1);
  });

  it("computes on-time rate", () => {
    const agent = makeAgent("a");
    const orders = [
      { sellerAgentId: "a", latencyMs: 1000, maxSeconds: 60, status: "completed" },
      { sellerAgentId: "a", latencyMs: 120000, maxSeconds: 60, status: "completed" },
    ];
    const sla = computeSLA(agent, orders);
    expect(sla.totalDeliveries).toBe(2);
    expect(sla.lateDeliveries).toBe(1);
    expect(sla.onTimeRate).toBe(0.5);
  });
});

describe("Reputation V2 — combined score", () => {
  it("adjusts score with reviews", () => {
    const agent = makeAgent("rep1");
    const r1 = computeReputationV2(agent, [], 10);
    const agentId = agent.id;
    addReview({ agentId, orderId: "o1", reviewerAgentId: "b1", rating: 5, comment: "" });
    const r2 = computeReputationV2(agent, [], 10);
    // review adds up to +10 points
    expect(r2.score).toBeGreaterThanOrEqual(r1.score);
  });
});
