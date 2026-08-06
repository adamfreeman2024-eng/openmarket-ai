/**
 * Unit tests for the dispute.mediate capability (AI-assisted platform mediation).
 * Verifies:
 *  - OM Auditor + OM Mediator seed agents expose dispute.mediate + LLM offers
 *  - smart-discovery heuristic matches dispute/mediation goals
 *  - llmFulfill input validation (missing reason)
 *  - llmFulfill success paths produce {resolution, note} (JSON + keyword fallback)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock store to avoid file system side effects
vi.mock("@/lib/store", () => ({
  db: {
    listAgents: vi.fn(() => []),
    listOffers: vi.fn(() => []),
    listEscrows: vi.fn(() => []),
    listOrders: vi.fn(() => []),
  },
  newId: vi.fn((prefix: string) => `${prefix}_test`),
  utcDay: vi.fn(() => "2026-08-06"),
  audit: vi.fn(),
}));

// llmConfigured=false so discoverForGoal falls back to heuristic matching
vi.mock("@/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  return {
    ...actual,
    llmConfigured: vi.fn(() => false),
  };
});

import { SEED_AGENTS } from "../lib/seed-agents";
import { discoverForGoal } from "../lib/smart-discovery";
import { llmFulfill } from "../lib/llm";

const MEDIATION_JSON = JSON.stringify({
  resolution: "refund",
  note: "Seller failed to deliver the described output; buyer is entitled to a full refund.",
});

async function mockChatOk(text: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: text } }],
        model: "test-model",
      }),
    }))
  );
}

describe("dispute.mediate capability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TOKENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
  });

  it("OM Mediator seed agent exposes dispute.mediate capability + offer", () => {
    const mediator = SEED_AGENTS.find((a) => a.id === "agt_seed_mediator");
    expect(mediator).toBeDefined();
    expect(mediator?.capabilities).toContain("dispute.mediate");
    const offer = mediator?.offers.find((o) => o.capability === "dispute.mediate");
    expect(offer).toBeDefined();
    expect(offer?.fulfillmentType).toBe("llm");
    expect(offer?.priceAsset).toBe("HBAR");
    expect(offer?.priceAmount).toBeGreaterThan(0);
  });

  it("OM Auditor also exposes dispute.mediate alongside its audit capabilities", () => {
    const auditor = SEED_AGENTS.find((a) => a.id === "agt_seed_auditor");
    expect(auditor).toBeDefined();
    expect(auditor?.capabilities).toContain("dispute.mediate");
    expect(auditor?.capabilities).toContain("legal.tos_audit");
  });

  it("smart-discovery heuristic matches dispute/mediation goals", async () => {
    const res = await discoverForGoal("mediate my order dispute and get a refund");
    expect(res.mode).toBe("heuristic");
    expect(res.capabilities).toContain("dispute.mediate");
  });

  it("smart-discovery heuristic matches arbitrate/order-dispute phrasing", async () => {
    const res = await discoverForGoal("I want to arbitrate this order dispute");
    expect(res.capabilities).toContain("dispute.mediate");
  });

  it("llmFulfill rejects missing reason", async () => {
    process.env.TOKENROUTER_API_KEY = "test-key";
    const res = await llmFulfill("dispute.mediate", {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("MISSING_REASON");
  });

  it("llmFulfill returns resolution + note from LLM JSON", async () => {
    process.env.TOKENROUTER_API_KEY = "test-key";
    await mockChatOk(MEDIATION_JSON);
    const res = await llmFulfill("dispute.mediate", {
      reason: "Wrong deliverable",
      description: "Received a summary instead of the full report",
      seller_response: "Will fix it tomorrow",
      buyer: "buyer-agent-1",
      seller: "seller-agent-1",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.resolution).toBe("refund");
      expect(res.result.note).toContain("full refund");
      expect(res.result.mode).toBe("llm");
    }
  });

  it("llmFulfill falls back to keyword scan when response is not JSON", async () => {
    process.env.TOKENROUTER_API_KEY = "test-key";
    await mockChatOk("Decision: I recommend a partial resolution because both sides share fault.");
    const res = await llmFulfill("dispute.mediate", {
      reason: "Shared fault",
      description: "Both parties contributed to the issue",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.resolution).toBe("partial");
      expect(res.result.note.length).toBeGreaterThan(0);
      expect(res.result.mode).toBe("llm");
    }
  });

  it("llmFulfill defaults to keep when the response is ambiguous", async () => {
    process.env.TOKENROUTER_API_KEY = "test-key";
    await mockChatOk("After reviewing, the seller delivered as promised.");
    const res = await llmFulfill("dispute.mediate", {
      reason: "Complaint",
      description: "Unclear claim",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.resolution).toBe("keep");
    }
  });
});
