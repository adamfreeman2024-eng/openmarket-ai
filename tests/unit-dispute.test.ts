import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createDispute,
  respondToDispute,
  resolveDispute,
  getDispute,
  listDisputes,
  autoResolveStaleDisputes,
  applyMediation,
} from "../lib/dispute";
import { db } from "../lib/store";
import type { EscrowRecord } from "../lib/store-types";

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

describe("Dispute escrow integration", () => {
  function makeEscrow(status: EscrowRecord["status"] = "locked") {
    const id = `esc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const orderId = `o-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const escrow: EscrowRecord = {
      id,
      orderId,
      status,
      amount: 10,
      asset: "HBAR",
      sellerAgentId: "seller1",
      createdAt: now,
      updatedAt: now,
    };
    db.putEscrow(escrow);
    return escrow;
  }

  it("opening a dispute marks the escrow as disputed", () => {
    const escrow = makeEscrow("locked");
    const d = createDispute({
      orderId: escrow.orderId,
      escrowId: escrow.id,
      buyerAgentId: "buyer1",
      sellerAgentId: "seller1",
      reason: "Bad deliverable",
      description: "Wrong output",
    });
    expect(d.status).toBe("open");
    expect(db.getEscrow(escrow.id)?.status).toBe("disputed");
  });

  it("resolve keep releases the escrow to the seller", () => {
    const escrow = makeEscrow("disputed");
    const d = createDispute({
      orderId: escrow.orderId,
      escrowId: escrow.id,
      buyerAgentId: "buyer1",
      sellerAgentId: "seller1",
      reason: "Issue",
      description: "",
    });
    const resolved = resolveDispute(d.id, "keep", "platform", "evidence ok");
    expect(resolved?.status).toBe("resolved_keep");
    expect(resolved?.resolvedBy).toBe("platform");
    expect(db.getEscrow(escrow.id)?.status).toBe("released");
    expect(db.getEscrow(escrow.id)?.reason).toBe("dispute_resolved_keep");
  });

  it("resolve refund refunds the escrow to the buyer", () => {
    const escrow = makeEscrow("disputed");
    const d = createDispute({
      orderId: escrow.orderId,
      escrowId: escrow.id,
      buyerAgentId: "buyer1",
      sellerAgentId: "seller1",
      reason: "Issue",
      description: "",
    });
    const resolved = resolveDispute(d.id, "refund", "seller", "my fault");
    expect(resolved?.status).toBe("resolved_refund");
    expect(db.getEscrow(escrow.id)?.status).toBe("refunded");
    expect(db.getEscrow(escrow.id)?.reason).toBe("dispute_refund");
  });

  it("partial refund is 50/50 split (seller keeps half via released escrow)", () => {
    const escrow = makeEscrow("disputed");
    const d = createDispute({
      orderId: escrow.orderId,
      escrowId: escrow.id,
      buyerAgentId: "buyer1",
      sellerAgentId: "seller1",
      reason: "Issue",
      description: "",
    });
    const resolved = resolveDispute(d.id, "partial", "platform", "50%");
    expect(resolved?.status).toBe("resolved_refund");
    expect(db.getEscrow(escrow.id)?.status).toBe("released");
    expect(db.getEscrow(escrow.id)?.reason).toBe("dispute_partial_50");
  });

  it("cannot respond to an already resolved dispute", () => {
    const escrow = makeEscrow("disputed");
    const d = createDispute({
      orderId: escrow.orderId,
      escrowId: escrow.id,
      buyerAgentId: "buyer1",
      sellerAgentId: "seller1",
      reason: "Issue",
      description: "",
    });
    resolveDispute(d.id, "refund", "seller");
    expect(respondToDispute(d.id, "seller1", "too late")).toBeNull();
  });

  it("resolveDispute returns null for an unknown id", () => {
    expect(resolveDispute("dsp_missing", "refund", "platform")).toBeNull();
  });
});

describe("Auto-resolve stale disputes (24h)", () => {
  const DAY = 24 * 60 * 60 * 1000;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-refunds open disputes older than 24h", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));

    const escrowId = `esc-stale-${Date.now()}`;
    const d = createDispute({
      orderId: `o-stale-${Date.now()}`,
      escrowId,
      buyerAgentId: "buyer1",
      sellerAgentId: "seller1",
      reason: "No response",
      description: "",
    });
    const escrow: EscrowRecord = {
      id: escrowId,
      orderId: d.orderId,
      status: "disputed",
      amount: 10,
      asset: "HBAR",
      sellerAgentId: "seller1",
      createdAt: d.createdAt,
      updatedAt: d.createdAt,
    };
    db.putEscrow(escrow);

    vi.advanceTimersByTime(DAY + 60_000);
    const stale = autoResolveStaleDisputes();

    expect(stale.some((x) => x.id === d.id)).toBe(true);
    const after = getDispute(d.id);
    expect(after?.status).toBe("auto_refunded");
    expect(after?.resolvedBy).toBe("auto");
    expect(after?.resolution).toBe("refund");
    expect(db.getEscrow(escrowId)?.status).toBe("refunded");
    expect(db.getEscrow(escrowId)?.reason).toBe("dispute_auto_refund");
  });

  it("leaves fresh open disputes alone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));

    const d = createDispute({
      orderId: `o-fresh-${Date.now()}`,
      escrowId: "esc-fresh",
      buyerAgentId: "buyer1",
      sellerAgentId: "seller1",
      reason: "Issue",
      description: "",
    });

    vi.advanceTimersByTime(60 * 60 * 1000); // 1h
    const stale = autoResolveStaleDisputes();

    expect(stale.some((x) => x.id === d.id)).toBe(false);
    expect(getDispute(d.id)?.status).toBe("open");
  });

  it("does not auto-resolve responded disputes even when old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));

    const d = createDispute({
      orderId: `o-responded-${Date.now()}`,
      escrowId: "esc-responded",
      buyerAgentId: "buyer1",
      sellerAgentId: "seller1",
      reason: "Issue",
      description: "",
    });
    respondToDispute(d.id, "seller1", "Working on it");

    vi.advanceTimersByTime(DAY + 60_000);
    const stale = autoResolveStaleDisputes();

    expect(stale.some((x) => x.id === d.id)).toBe(false);
    expect(getDispute(d.id)?.status).toBe("responded");
  });
});

describe("AI-mediated platform resolution (applyMediation)", () => {
  function makeDisputedEscrow() {
    const id = `esc-med-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const orderId = `o-med-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const escrow: EscrowRecord = {
      id,
      orderId,
      status: "disputed",
      amount: 10,
      asset: "HBAR",
      sellerAgentId: "seller1",
      createdAt: now,
      updatedAt: now,
    };
    db.putEscrow(escrow);
    const d = createDispute({
      orderId,
      escrowId: id,
      buyerAgentId: "buyer1",
      sellerAgentId: "seller1",
      reason: "Bad deliverable",
      description: "",
    });
    return { d, escrow: id };
  }

  it("applies AI refund mediation as platform resolution", () => {
    const { d, escrow } = makeDisputedEscrow();
    const resolved = applyMediation(d.id, "refund", "seller admitted fault");
    expect(resolved?.status).toBe("resolved_refund");
    expect(resolved?.resolvedBy).toBe("platform");
    expect(resolved?.resolution).toBe("refund");
    expect(resolved?.resolutionNote).toContain("AI-mediated");
    expect(db.getEscrow(escrow)?.status).toBe("refunded");
    expect(db.getEscrow(escrow)?.reason).toBe("dispute_refund");
  });

  it("applies AI keep mediation and releases the escrow to the seller", () => {
    const { d, escrow } = makeDisputedEscrow();
    const resolved = applyMediation(d.id, "keep", "evidence supports seller");
    expect(resolved?.status).toBe("resolved_keep");
    expect(resolved?.resolvedBy).toBe("platform");
    expect(db.getEscrow(escrow)?.status).toBe("released");
    expect(db.getEscrow(escrow)?.reason).toBe("dispute_resolved_keep");
  });

  it("applies AI partial mediation as 50/50 split (released + partial reason)", () => {
    const { d, escrow } = makeDisputedEscrow();
    const resolved = applyMediation(d.id, "partial", "split fault 50/50");
    expect(resolved?.status).toBe("resolved_refund");
    expect(db.getEscrow(escrow)?.status).toBe("released");
    expect(db.getEscrow(escrow)?.reason).toBe("dispute_partial_50");
  });

  it("returns null for an unknown dispute id", () => {
    expect(applyMediation("dsp_missing", "refund")).toBeNull();
  });
});
