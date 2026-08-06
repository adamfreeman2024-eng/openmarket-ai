import { describe, it, expect } from "vitest";
import { computeLeaderboard } from "../lib/developer-portal";
import type { AgentRecord, OrderRecord } from "../lib/types";

function makeAgent(
  id: string,
  over: Partial<AgentRecord> = {}
): AgentRecord {
  return {
    id,
    apiKey: "k_" + id,
    name: `Agent ${id}`,
    walletAccountId: "0.0.1",
    capabilities: ["text.translate"],
    policy: {
      dailySpendLimit: 10,
      maxPerTx: 5,
      allowedCounterparties: [],
      allowedHours: [],
      velocityPerMinute: 0,
      spentToday: 0,
      spentDay: "2026-08-06",
      spentAt: [],
    },
    stats: { sales: 0, purchases: 0, success: 0, fail: 0, totalLatencyMs: 0 },
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function makeOrder(
  id: string,
  sellerAgentId: string,
  status: OrderRecord["status"],
  totalAmount: number
): OrderRecord {
  return {
    id,
    quoteId: "q_" + id,
    offerId: "o_" + id,
    sellerAgentId,
    totalAmount,
    platformFee: totalAmount * 0.02,
    priceAsset: "HBAR",
    status,
    createdAt: "2026-08-02T00:00:00.000Z",
  };
}

describe("computeLeaderboard", () => {
  it("ranks by revenue and hires using completed orders only", () => {
    const agents = [
      makeAgent("agt_a", { stats: { sales: 2, purchases: 0, success: 2, fail: 0, totalLatencyMs: 10 } }),
      makeAgent("agt_b", { stats: { sales: 3, purchases: 0, success: 3, fail: 1, totalLatencyMs: 20 } }),
      makeAgent("agt_c", { stats: { sales: 0, purchases: 0, success: 0, fail: 0, totalLatencyMs: 0 } }),
    ];
    const orders = [
      makeOrder("o1", "agt_a", "completed", 10),
      makeOrder("o2", "agt_a", "completed", 5),
      makeOrder("o3", "agt_b", "completed", 100),
      makeOrder("o4", "agt_b", "failed", 50), // ignored
      makeOrder("o5", "agt_a", "paid", 99), // not completed → ignored
    ];

    const board = computeLeaderboard(agents, orders, 10);

    expect(board.byRevenue.map((r) => r.key)).toEqual(["agt_b", "agt_a", "agt_c"]);
    expect(board.byRevenue[0].revenue).toBe(100);
    expect(board.byRevenue[1].revenue).toBe(15);
    expect(board.byRevenue[1].hires).toBe(2);

    expect(board.byHires.map((r) => r.key)).toEqual(["agt_a", "agt_b", "agt_c"]);
    expect(board.byHires[0].hires).toBe(2);
    expect(board.byHires[1].hires).toBe(1);

    // Agent with no orders still appears (platform member) with zero revenue.
    const keys = board.byRevenue.map((r) => r.key);
    expect(keys).toContain("agt_c");
  });

  it("respects the limit", () => {
    const agents = ["a", "b", "c"].map((x) => makeAgent("agt_" + x));
    const board = computeLeaderboard(agents, [], 2);
    expect(board.byRevenue.length).toBe(2);
    expect(board.byHires.length).toBe(2);
  });

  it("groups multiple agents under the same githubHandle", () => {
    const agents = [
      makeAgent("agt_a", { githubHandle: "alice", stats: { sales: 1, purchases: 0, success: 1, fail: 0, totalLatencyMs: 5 } }),
      makeAgent("agt_b", { githubHandle: "alice", stats: { sales: 1, purchases: 0, success: 1, fail: 0, totalLatencyMs: 5 } }),
      makeAgent("agt_c", { githubHandle: "bob" }),
    ];
    const orders = [
      makeOrder("o1", "agt_a", "completed", 20),
      makeOrder("o2", "agt_b", "completed", 30),
    ];

    const board = computeLeaderboard(agents, orders, 10);
    expect(board.byRevenue[0].key).toBe("alice");
    expect(board.byRevenue[0].revenue).toBe(50);
    expect(board.byRevenue[0].agentIds).toEqual(["agt_a", "agt_b"]);
    expect(board.byRevenue[0].hires).toBe(2);
  });

  it("reports successRate null when no attempts, otherwise success/total", () => {
    const agents = [
      makeAgent("agt_a", { stats: { sales: 1, purchases: 0, success: 4, fail: 1, totalLatencyMs: 5 } }),
      makeAgent("agt_b"),
    ];
    const board = computeLeaderboard(agents, [], 10);
    const a = board.byRevenue.find((r) => r.key === "agt_a")!;
    const b = board.byRevenue.find((r) => r.key === "agt_b")!;
    expect(a.successRate).toBeCloseTo(0.8);
    expect(b.successRate).toBeNull();
  });
});
