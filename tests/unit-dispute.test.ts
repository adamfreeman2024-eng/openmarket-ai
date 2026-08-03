import { describe, it, expect } from "vitest";
import {
  createDispute,
  respondToDispute,
  resolveDispute,
  getDispute,
  listDisputes,
} from "../lib/dispute";

// NOTE: these tests mutate the in-memory dispute store; unique ids per test
// keep them isolated. Persistence writes go to data/disputes.json (harmless).

describe("Dispute Resolution", () => {
  it("creates a dispute with open status", () => {
    const d = createDispute({
      orderId: `o-${Date.now()}-1`,
      escrowId: `esc-${Date.now()}-1`,
      buyerAgentId: "buyer1",
      sellerAgentId: "seller1",
      reason: "Bad quality",
      description: "The deliverable was wrong",
    });
    expect(d.status).toBe("open");
    expect(d.id.startsWith("dsp_")).toBe(true);
    expect(getDispute(d.id)?.id).toBe(d.id);
  });

  it("seller can respond to open dispute", () => {
    const d = createDispute({
      orderId: `o-${Date.now()}-2`,
      escrowId: `esc-${Date.now()}-2`,
      buyerAgentId: "buyer1",
      sellerAgentId: "seller1",
      reason: "Issue",
      description: "",
    });
    const updated = respondToDispute(d.id, "seller1", "Will fix it");
    expect(updated?.status).toBe("responded");
    expect(updated?.sellerResponse).toBe("Will fix it");
  });

  it("non-seller cannot respond", () => {
    const d = createDispute({
      orderId: `o-${Date.now()}-3`,
      escrowId: `esc-${Date.now()}-3`,
      buyerAgentId: "buyer1",
      sellerAgentId: "seller1",
      reason: "Issue",
      description: "",
    });
    expect(respondToDispute(d.id, "buyer1", "nope")).toBeNull();
  });

  it("resolve with refund sets status", () => {
    const d = createDispute({
      orderId: `o-${Date.now()}-4`,
      escrowId: `esc-${Date.now()}-4`,
      buyerAgentId: "buyer1",
      sellerAgentId: "seller1",
      reason: "Issue",
      description: "",
    });
    const resolved = resolveDispute(d.id, "refund", "seller", "sorry");
    expect(resolved?.status).toBe("resolved_refund");
    expect(resolved?.resolution).toBe("refund");
    expect(resolved?.resolvedBy).toBe("seller");
  });

  it("listDisputes filters by agent", () => {
    const id = `o-${Date.now()}-5`;
    const d = createDispute({
      orderId: id,
      escrowId: `esc-${Date.now()}-5`,
      buyerAgentId: "buyerX",
      sellerAgentId: "sellerX",
      reason: "Issue",
      description: "",
    });
    const forBuyer = listDisputes("buyerX");
    const forOther = listDisputes("nobody");
    expect(forBuyer.some((x) => x.id === d.id)).toBe(true);
    expect(forOther.some((x) => x.id === d.id)).toBe(false);
  });

  it("resolved dispute cannot be re-resolved", () => {
    const d = createDispute({
      orderId: `o-${Date.now()}-6`,
      escrowId: `esc-${Date.now()}-6`,
      buyerAgentId: "buyer1",
      sellerAgentId: "seller1",
      reason: "Issue",
      description: "",
    });
    resolveDispute(d.id, "refund", "seller");
    expect(resolveDispute(d.id, "keep", "seller")).toBeNull();
  });
});
