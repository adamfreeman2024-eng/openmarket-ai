/**
 * Unit tests for lib/analytics — getAgentAnalytics.
 * Covers dailyRevenue (30-day zero-filled chart source) and errorFeed
 * (recent failed orders with messages) added in v1.5.4.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockStore = vi.hoisted(() => ({
  agents: [] as any[],
  orders: [] as any[],
  escrows: [] as any[],
  offers: [] as any[],
}));

vi.mock("@/lib/store", () => ({
  db: {
    getAgent: (id: string) => mockStore.agents.find((a) => a.id === id) || null,
    listOrders: () => mockStore.orders,
    listEscrows: () => mockStore.escrows,
    listOffers: () => mockStore.offers,
  },
}));

vi.mock("@/lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/cache", () => ({
  cache: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
}));

import { getAgentAnalytics } from "../lib/analytics";

const AGENT_ID = "agt_test_analytics";

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: `ord_${Math.random().toString(36).slice(2, 8)}`,
    quoteId: "q_1",
    offerId: "off_1",
    sellerAgentId: AGENT_ID,
    totalAmount: 10,
    platformFee: 0.2,
    priceAsset: "HBAR" as const,
    status: "completed" as const,
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function seed(orders: any[], agents: any[] = []) {
  mockStore.orders = orders;
  mockStore.escrows = [];
  mockStore.offers = [{ id: "off_1", agentId: AGENT_ID, capability: "text.translate", priceAmount: 10, active: true }];
  mockStore.agents = [{ id: AGENT_ID, name: "Test Agent", capabilities: ["text.translate"] }, ...agents];
}

beforeEach(() => {
  mockStore.orders = [];
  mockStore.escrows = [];
  mockStore.offers = [];
  mockStore.agents = [];
});

describe("getAgentAnalytics — dailyRevenue", () => {
  it("aggregates completed revenue per day and zero-fills all 30 days", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    seed([
      baseOrder({ totalAmount: 25.5, completedAt: `${today}T12:00:00.000Z` }),
      baseOrder({ totalAmount: 4.5, completedAt: `${today}T13:00:00.000Z` }),
      baseOrder({ totalAmount: 7, completedAt: `${yesterday}T09:00:00.000Z` }),
      // not completed → excluded from revenue
      baseOrder({ status: "failed", totalAmount: 99, error: "boom" }),
    ]);

    const a = await getAgentAnalytics(AGENT_ID);
    expect(a).not.toBeNull();
    expect(a!.dailyRevenue).toHaveLength(30);
    // Dates strictly ascending, ending today
    expect(a!.dailyRevenue[29].date).toBe(today);
    expect(a!.dailyRevenue[28].date).toBe(yesterday);
    expect(a!.dailyRevenue[29].revenue).toBe(30);
    expect(a!.dailyRevenue[28].revenue).toBe(7);
    // Zero-filled gap day
    expect(a!.dailyRevenue[27].revenue).toBe(0);
    // Sum over the window equals completed volume only
    const total = a!.dailyRevenue.reduce((s, d) => s + d.revenue, 0);
    expect(total).toBe(37);
  });

  it("falls back to createdAt when completedAt is missing", async () => {
    const today = new Date().toISOString().slice(0, 10);
    seed([baseOrder({ completedAt: undefined, createdAt: `${today}T10:00:00.000Z`, totalAmount: 3.333 })]);
    const a = await getAgentAnalytics(AGENT_ID);
    expect(a!.dailyRevenue[29].date).toBe(today);
    expect(a!.dailyRevenue[29].revenue).toBe(3.33); // rounded to cents
  });

  it("returns 30 zero days when no orders exist", async () => {
    seed([]);
    const a = await getAgentAnalytics(AGENT_ID);
    expect(a!.dailyRevenue).toHaveLength(30);
    expect(a!.dailyRevenue.every((d) => d.revenue === 0)).toBe(true);
  });
});

describe("getAgentAnalytics — errorFeed", () => {
  it("lists failed orders with messages, newest first, max 10", async () => {
    seed([
      baseOrder({ id: "ord_old", status: "failed", error: "old err", createdAt: "2026-08-01T10:00:00.000Z" }),
      baseOrder({ id: "ord_new", status: "failed", error: "new err", createdAt: "2026-08-05T10:00:00.000Z" }),
      // failed without message → excluded
      baseOrder({ id: "ord_noerr", status: "failed", createdAt: "2026-08-06T10:00:00.000Z" }),
      // completed with error field set → excluded (not failed)
      baseOrder({ id: "ord_comp", status: "completed", error: "should not appear" }),
    ]);

    const a = await getAgentAnalytics(AGENT_ID);
    expect(a!.errorFeed).toEqual([
      { id: "ord_new", error: "new err", createdAt: "2026-08-05T10:00:00.000Z" },
      { id: "ord_old", error: "old err", createdAt: "2026-08-01T10:00:00.000Z" },
    ]);
  });

  it("caps the feed at 10 entries", async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      baseOrder({ id: `ord_${i}`, status: "failed", error: `err ${i}`, createdAt: `2026-08-01T${String(i).padStart(2, "0")}:00:00.000Z` })
    );
    seed(many);
    const a = await getAgentAnalytics(AGENT_ID);
    expect(a!.errorFeed).toHaveLength(10);
    expect(a!.errorFeed[0].error).toBe("err 14"); // newest first
  });

  it("returns empty feed when no failed orders", async () => {
    seed([baseOrder({ status: "completed" })]);
    const a = await getAgentAnalytics(AGENT_ID);
    expect(a!.errorFeed).toEqual([]);
  });
});

describe("getAgentAnalytics — guard", () => {
  it("returns null when the agent does not exist", async () => {
    mockStore.agents = [];
    const a = await getAgentAnalytics("agt_missing");
    expect(a).toBeNull();
  });
});
