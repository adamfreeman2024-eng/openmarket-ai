/**
 * Unit tests for the legal.tos_audit and security.smart_contract_audit
 * capabilities (Phase 2.5 — AI Agent-as-a-Service).
 * Verifies:
 *  - OM Auditor seed agent exposes both capabilities + LLM offers
 *  - smart-discovery heuristic matches tos/legal and smart-contract goals
 *  - llmFulfill input validation (missing document_url / contract_code)
 *  - llmFulfill success paths produce auditReport / securityReport
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

const FAKE_REPORT = "FINDINGS: no critical issues. RECOMMENDATIONS: add refund clause.";

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

describe("legal.tos_audit capability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TOKENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
  });

  it("OM Auditor seed agent exposes legal.tos_audit capability + offer", () => {
    const auditor = SEED_AGENTS.find((a) => a.id === "agt_seed_auditor");
    expect(auditor).toBeDefined();
    expect(auditor?.capabilities).toContain("legal.tos_audit");
    const offer = auditor?.offers.find((o) => o.capability === "legal.tos_audit");
    expect(offer).toBeDefined();
    expect(offer?.fulfillmentType).toBe("llm");
    expect(offer?.priceAsset).toBe("HBAR");
    expect(offer?.priceAmount).toBeGreaterThan(0);
  });

  it("smart-discovery heuristic matches tos/legal goals to legal.tos_audit", async () => {
    const res = await discoverForGoal("review my terms of service privacy policy");
    expect(res.mode).toBe("heuristic");
    expect(res.capabilities).toContain("legal.tos_audit");
  });

  it("llmFulfill rejects missing document_url", async () => {
    process.env.TOKENROUTER_API_KEY = "test-key";
    const res = await llmFulfill("legal.tos_audit", {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("MISSING_DOCUMENT_URL");
  });

  it("llmFulfill returns auditReport on success", async () => {
    process.env.TOKENROUTER_API_KEY = "test-key";
    await mockChatOk(FAKE_REPORT);
    const res = await llmFulfill("legal.tos_audit", {
      document_url: "https://example.com/tos",
      context: "Marketplace for AI agents",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.auditReport).toBe(FAKE_REPORT);
      expect(res.result.documentUrl).toBe("https://example.com/tos");
      expect(res.result.mode).toBe("llm");
    }
  });
});

describe("security.smart_contract_audit capability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TOKENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
  });

  it("OM Auditor seed agent exposes security.smart_contract_audit capability + offer", () => {
    const auditor = SEED_AGENTS.find((a) => a.id === "agt_seed_auditor");
    expect(auditor).toBeDefined();
    expect(auditor?.capabilities).toContain("security.smart_contract_audit");
    const offer = auditor?.offers.find(
      (o) => o.capability === "security.smart_contract_audit"
    );
    expect(offer).toBeDefined();
    expect(offer?.fulfillmentType).toBe("llm");
    expect(offer?.priceAsset).toBe("HBAR");
    expect(offer?.priceAmount).toBeGreaterThan(0);
  });

  it("smart-discovery heuristic matches smart-contract/solidity goals", async () => {
    const res = await discoverForGoal("audit my solidity smart contract reentrancy");
    expect(res.mode).toBe("heuristic");
    expect(res.capabilities).toContain("security.smart_contract_audit");
  });

  it("llmFulfill rejects missing contract_code", async () => {
    process.env.TOKENROUTER_API_KEY = "test-key";
    const res = await llmFulfill("security.smart_contract_audit", {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("MISSING_CONTRACT_CODE");
  });

  it("llmFulfill returns securityReport on success", async () => {
    process.env.TOKENROUTER_API_KEY = "test-key";
    await mockChatOk("CRITICAL: reentrancy in withdraw().");
    const res = await llmFulfill("security.smart_contract_audit", {
      contract_code: "pragma solidity ^0.8.0; contract Escrow {}",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.securityReport).toBe("CRITICAL: reentrancy in withdraw().");
      expect(res.result.contractCodeChars).toBeGreaterThan(10);
      expect(res.result.mode).toBe("llm");
    }
  });
});
