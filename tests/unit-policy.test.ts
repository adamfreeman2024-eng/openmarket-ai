/**
 * Unit tests for policy evaluation — spend limits, allowlists, daily reset.
 */
import { describe, it, expect, vi } from "vitest";
import { evaluateBuyerPolicy, allAllowed } from "../lib/policy";
import type { AgentRecord } from "../lib/types";

// Mock utcDay to return a fixed date for deterministic tests
vi.mock("../lib/store", () => ({
  utcDay: () => "2026-07-19",
}));

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
        maxPerTx: 100, // Set high so MaxPerTx doesn't block first
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

describe("policy TimeWindow", () => {
  it("allows when now is inside the window", () => {
    const agent = mockAgent({
      policy: {
        dailySpendLimit: 100,
        maxPerTx: 10,
        allowedCounterparties: [],
        allowedHours: [["00:00", "23:59"]],
        velocityPerMinute: 0,
        spentToday: 0,
        spentDay: "2026-07-19",
        spentAt: [],
      },
    });
    const res = evaluateBuyerPolicy(agent, 1);
    const tw = res.find((r) => r.policy === "TimeWindow");
    expect(tw?.allowed).toBe(true);
  });

  it("supports overnight windows (end < start)", () => {
    const agent = mockAgent({
      policy: {
        dailySpendLimit: 100,
        maxPerTx: 10,
        allowedCounterparties: [],
        allowedHours: [["22:00", "02:00"]],
        velocityPerMinute: 0,
        spentToday: 0,
        spentDay: "2026-07-19",
        spentAt: [],
      },
    });
    const now = new Date();
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    const res = evaluateBuyerPolicy(agent, 1);
    const tw = res.find((r) => r.policy === "TimeWindow");
    // overnight window covers 22:00..23:59 and 00:00..01:59
    const inside = mins >= 22 * 60 || mins < 2 * 60;
    expect(tw?.allowed).toBe(inside);
  });

  it("blocks when no window covers now", () => {
    // force a window that cannot contain the current UTC minute (unless it IS exactly 00:00:xx)
    const agent = mockAgent({
      policy: {
        dailySpendLimit: 100,
        maxPerTx: 10,
        allowedCounterparties: [],
        allowedHours: [["00:00", "00:01"]],
        velocityPerMinute: 0,
        spentToday: 0,
        spentDay: "2026-07-19",
        spentAt: [],
      },
    });
    const now = new Date();
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    const res = evaluateBuyerPolicy(agent, 1);
    const tw = res.find((r) => r.policy === "TimeWindow");
    // At exactly 00:00 it passes; otherwise it must block
    if (mins === 0) {
      expect(tw?.allowed).toBe(true);
    } else {
      expect(tw?.allowed).toBe(false);
    }
  });
});

describe("policy Velocity", () => {
  it("allows below limit and blocks after reaching it", () => {
    const agent = mockAgent({
      policy: {
        dailySpendLimit: 100,
        maxPerTx: 10,
        allowedCounterparties: [],
        allowedHours: [],
        velocityPerMinute: 2,
        spentToday: 0,
        spentDay: "2026-07-19",
        spentAt: [],
      },
    });
    let persisted: AgentRecord | null = null;
    const persist = (a: AgentRecord) => { persisted = a; };

    const r1 = evaluateBuyerPolicy(agent, 1, undefined, persist).find((r) => r.policy === "Velocity");
    expect(r1?.allowed).toBe(true);
    const r2 = evaluateBuyerPolicy(agent, 1, undefined, persist).find((r) => r.policy === "Velocity");
    expect(r2?.allowed).toBe(true);
    const r3 = evaluateBuyerPolicy(agent, 1, undefined, persist).find((r) => r.policy === "Velocity");
    expect(r3?.allowed).toBe(false);
    expect(persisted).not.toBeNull();
  });

  it("is unrestricted when velocityPerMinute is 0", () => {
    const agent = mockAgent({
      policy: {
        dailySpendLimit: 100,
        maxPerTx: 10,
        allowedCounterparties: [],
        allowedHours: [],
        velocityPerMinute: 0,
        spentToday: 0,
        spentDay: "2026-07-19",
        spentAt: [],
      },
    });
    const res = evaluateBuyerPolicy(agent, 1).find((r) => r.policy === "Velocity");
    expect(res?.allowed).toBe(true);
  });
});
