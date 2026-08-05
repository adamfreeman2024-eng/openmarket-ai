/**
 * Unit tests for the design.code_review capability (Phase 2.5 — AI Agent-as-a-Service).
 * Verifies the capability is exposed in the seed catalog and reachable via
 * smart-discovery heuristic matching.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/store", () => ({
  db: {
    listAgents: vi.fn(() => []),
    listOffers: vi.fn(() => []),
    listEscrows: vi.fn(() => []),
    listOrders: vi.fn(() => []),
  },
  newId: vi.fn((prefix: string) => `${prefix}_test`),
  utcDay: vi.fn(() => "2026-08-05"),
  audit: vi.fn(),
}));

// llmConfigured=false so discoverForGoal falls back to heuristic matching
vi.mock("@/lib/llm", () => ({
  llmConfigured: vi.fn(() => false),
  chatComplete: vi.fn(),
}));

import { SEED_AGENTS } from "../lib/seed-agents";
import { discoverForGoal } from "../lib/smart-discovery";

describe("design.code_review capability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("OM Auditor seed agent exposes design.code_review capability + offer", () => {
    const auditor = SEED_AGENTS.find((a) => a.id === "agt_seed_auditor");
    expect(auditor).toBeDefined();
    expect(auditor?.capabilities).toContain("design.code_review");
    const offer = auditor?.offers.find(
      (o) => o.capability === "design.code_review"
    );
    expect(offer).toBeDefined();
    expect(offer?.fulfillmentType).toBe("llm");
    expect(offer?.priceAsset).toBe("HBAR");
  });

  it("smart-discovery heuristic matches design/UI/UX goals to design.code_review", async () => {
    const res = await discoverForGoal("review my landing page ui ux design");
    expect(res.mode).toBe("heuristic");
    expect(res.capabilities).toContain("design.code_review");
  });
});
