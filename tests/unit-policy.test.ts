/**
 * Unit tests for policy evaluation — spend limits, allowlists, daily reset.
 */
import { describe, it, expect } from "vitest";
import { evaluateBuyerPolicy, allAllowed } from "../lib/policy";
import type { AgentRecord } from "../lib/types";

function mockAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agt_test",
    apiKey: "omk_test",
    name: "Test Agent",
    walletAccountId: "0.0.1234",
    capabilities: ["buyer"],
    policy: {
      dailySpendLimit: 100,
      maxPerTx: 10,
      allowedCounterparties: [],
      spentToday: 0,
      spentDay: "2026-07-19",
    },
    stats: { sales: 0, purchases: 0, success: 0, fail: 0, totalLatencyMs: 0 },
    createdAt: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

describe("evaluateBuyerPolicy — MaxPerTx", () => {
  it("should allow amount within maxPerTx", () => {
    const agent = mockAgent();
    const results = evaluateBuyerPolicy(agent, 5, "0.0.5678");
    const maxTx = results.find((r) => r.policy === "MaxPerTx");
    expect(maxTx?.allowed).toBe(true);
  });

  it("should block amount exceeding maxPerTx", () => {
    const agent = mockAgent();
    const results = evaluateBuyerPolicy(agent, 15, "0.0.5678");
    const maxTx = results.find((r) => r.policy === "MaxPerTx");
    expect(maxTx?.allowed).toBe(false);
  });
});

describe("evaluateBuyerPolicy — DailySpendLimit", () => {
  it("should allow when daily spend within limit", () => {
    const agent = mockAgent({
      policy: {
        dailySpendLimit: 100,
        maxPerTx: 10,
        allowedCounterparties: [],
        spentToday: 50,
        spentDay: "2026-07-19",
      },
    });
    const results = evaluateBuyerPolicy(agent, 10, "0.0.5678");
    const daily = results.find((r) => r.policy === "DailySpendLimit");
    expect(daily?.allowed).toBe(true);
  });

  it("should block when daily spend would exceed limit", () => {
    const agent = mockAgent({
      policy: {
        dailySpendLimit: 100,
        maxPerTx: 10,
        allowedCounterparties: [],
        spentToday: 95,
        spentDay: "2026-07-19",
      },
    });
    const results = evaluateBuyerPolicy(agent, 10, "0.0.5678");
    const daily = results.find((r) => r.policy === "DailySpendLimit");
    expect(daily?.allowed).toBe(false);
  });
});

describe("evaluateBuyerPolicy — Allowlist", () => {
  it("should allow counterparty in allowlist", () => {
    const agent = mockAgent({
      policy: {
        dailySpendLimit: 100,
        maxPerTx: 10,
        allowedCounterparties: ["0.0.5678"],
        spentToday: 0,
        spentDay: "2026-07-19",
      },
    });
    const results = evaluateBuyerPolicy(agent, 5, "0.0.5678");
    const allow = results.find((r) => r.policy === "Allowlist");
    expect(allow?.allowed).toBe(true);
  });

  it("should block counterparty not in allowlist", () => {
    const agent = mockAgent({
      policy: {
        dailySpendLimit: 100,
        maxPerTx: 10,
        allowedCounterparties: ["0.0.9999"],
        spentToday: 0,
        spentDay: "2026-07-19",
      },
    });
    const results = evaluateBuyerPolicy(agent, 5, "0.0.5678");
    const allow = results.find((r) => r.policy === "Allowlist");
    expect(allow?.allowed).toBe(false);
  });
});

describe("evaluateBuyerPolicy — Anonymous buyer", () => {
  it("should allow small amounts for anonymous buyers", () => {
    const results = evaluateBuyerPolicy(undefined, 3, "0.0.5678");
    const anon = results.find((r) => r.policy === "AnonymousCap");
    expect(anon?.allowed).toBe(true);
    expect(allAllowed(results)).toBe(true);
  });

  it("should block large amounts for anonymous buyers", () => {
    const results = evaluateBuyerPolicy(undefined, 10, "0.0.5678");
    const anon = results.find((r) => r.policy === "AnonymousCap");
    expect(anon?.allowed).toBe(false);
    expect(allAllowed(results)).toBe(false);
  });
});

describe("allAllowed", () => {
  it("should return true when all policies allow", () => {
    const results = [
      { allowed: true, policy: "A" },
      { allowed: true, policy: "B" },
    ];
    expect(allAllowed(results)).toBe(true);
  });

  it("should return false when any policy blocks", () => {
    const results = [
      { allowed: true, policy: "A" },
      { allowed: false, policy: "B", reason: "blocked" },
    ];
    expect(allAllowed(results)).toBe(false);
  });
});
