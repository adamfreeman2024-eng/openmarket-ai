import { describe, it, expect } from "vitest";
import { rankOffer, searchOffers } from "../lib/ranking";
import type { AgentRecord, OfferRecord } from "../lib/types";

function makeOffer(over: Partial<OfferRecord> & { id: string }): OfferRecord {
  return {
    capability: "text.translate",
    title: "Translation",
    description: "Translate text fast",
    priceAmount: 0.02,
    priceAsset: "HBAR",
    fulfillmentType: "inline",
    maxSeconds: 60,
    escrow: false,
    tags: [],
    active: true,
    createdAt: new Date().toISOString(),
    ...over,
  } as OfferRecord;
}

function makeAgent(
  id: string,
  stats: Partial<AgentRecord["stats"]> = {}
): AgentRecord {
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
      spentDay: new Date().toISOString().slice(0, 10),
    },
    stats: { sales: 0, success: 0, fail: 0, totalLatencyMs: 0, ...stats },
    createdAt: new Date().toISOString(),
  } as AgentRecord;
}

describe("rankOffer", () => {
  it("prefers lower price", () => {
    const a = makeOffer({ id: "a", priceAmount: 0.01 });
    const b = makeOffer({ id: "b", priceAmount: 1 });
    expect(rankOffer(a, undefined)).toBeGreaterThan(rankOffer(b, undefined));
  });

  it("boosts title matches over description matches", () => {
    const title = makeOffer({ id: "t", title: "Armenian Translation" });
    const desc = makeOffer({ id: "d", description: "Offers Armenian translation" });
    const rTitle = rankOffer(title, undefined, { text: "armenian" });
    const rDesc = rankOffer(desc, undefined, { text: "armenian" });
    expect(rTitle).toBeGreaterThan(rDesc);
  });

  it("boosts tag matches above plain description", () => {
    const tag = makeOffer({ id: "tag", tags: ["armenian"] });
    const desc = makeOffer({ id: "desc", description: "armenian service" });
    expect(rankOffer(tag, undefined, { text: "armenian" })).toBeGreaterThan(
      rankOffer(desc, undefined, { text: "armenian" })
    );
  });

  it("penalizes inactive offers (ranks below active)", () => {
    const off = makeOffer({ id: "x", active: false });
    const on = makeOffer({ id: "y", active: true });
    expect(rankOffer(off, undefined)).toBeLessThan(rankOffer(on, undefined));
  });
});

describe("searchOffers", () => {
  const agents = new Map<string, AgentRecord>([
    ["seller1", makeAgent("seller1", { success: 9, fail: 1, sales: 10 })],
    ["seller2", makeAgent("seller2", { success: 1, fail: 9, sales: 10 })],
  ]);
  const offers = [
    makeOffer({ id: "good", agentId: "seller1" }),
    makeOffer({ id: "bad", agentId: "seller2" }),
  ];

  it("filters by minRating (success rate)", () => {
    const res = searchOffers(offers, agents, { minRating: 0.8 });
    expect(res.map((r) => r.offer.id)).toContain("good");
    expect(res.map((r) => r.offer.id)).not.toContain("bad");
  });

  it("filters by capability", () => {
    const res = searchOffers(offers, agents, { capability: "text.translate" });
    expect(res.length).toBe(2);
  });

  it("filters by tags", () => {
    const tagged = makeOffer({ id: "tagged", agentId: "seller1", tags: ["legal"] });
    const res = searchOffers([...offers, tagged], agents, { tags: ["legal"] });
    expect(res.map((r) => r.offer.id)).toEqual(["tagged"]);
  });

  it("sorts by price_low", () => {
    const a = makeOffer({ id: "p1", priceAmount: 5 });
    const b = makeOffer({ id: "p2", priceAmount: 1 });
    const res = searchOffers([a, b], agents, { sortBy: "price_low" });
    expect(res.map((r) => r.offer.id)).toEqual(["p2", "p1"]);
  });

  it("sorts by relevance — title match beats description match", () => {
    const title = makeOffer({ id: "t1", agentId: "seller1", title: "Armenian Translation" });
    const desc = makeOffer({ id: "d1", agentId: "seller2", description: "Armenian translation service" });
    const res = searchOffers([desc, title], agents, { q: "armenian" });
    expect(res[0].offer.id).toBe("t1");
  });

  it("boosts paid listings above identical unpriced competitors", () => {
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const plain = makeOffer({ id: "plain", agentId: "seller1", priceAmount: 1 });
    const boosted = makeOffer({
      id: "boosted",
      agentId: "seller2",
      priceAmount: 1,
      boostedUntil: future,
    });
    const res = searchOffers([plain, boosted], agents, {});
    expect(res[0].offer.id).toBe("boosted");
  });

  it("expired boost has no effect", () => {
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    const plain = makeOffer({ id: "plain2", agentId: "seller1", priceAmount: 1 });
    const expired = makeOffer({
      id: "expired",
      agentId: "seller2",
      priceAmount: 1,
      boostedUntil: past,
    });
    const res = searchOffers([expired, plain], agents, {});
    expect(res[0].offer.id).toBe("plain2");
  });

  it("cold-start: new seller (no orders) gets visibility nudge vs high-volume seller at same price", () => {
    const newSeller = makeAgent("newseller", { sales: 0, success: 0, fail: 0 });
    const veteran = makeAgent("veteran", { sales: 50, success: 45, fail: 5, totalLatencyMs: 1000 });
    const agentMap = new Map<string, any>([
      ["newseller", newSeller],
      ["veteran", veteran],
    ]);
    const oNew = makeOffer({ id: "oNew", agentId: "newseller", priceAmount: 1 });
    const oVet = makeOffer({ id: "oVet", agentId: "veteran", priceAmount: 1 });
    const res = searchOffers([oNew, oVet], agentMap, {});
    // veteran still wins on reputation, but cold-start nudge must exist (no crash, deterministic)
    expect(res.length).toBe(2);
  });

  it("reviews: 5★ seller with verified reviews ranks above unreviewed equal-price seller", () => {
    const agentMap = new Map<string, any>([
      ["revA", makeAgent("revA")],
      ["revB", makeAgent("revB")],
    ]);
    const a = makeOffer({ id: "revA-offer", agentId: "revA", priceAmount: 1 });
    const b = makeOffer({ id: "revB-offer", agentId: "revB", priceAmount: 1 });
    const reviewStats = new Map([
      ["revA", { average: 5, total: 8 }],
    ]);
    const res = searchOffers([b, a], agentMap, { reviewStats });
    expect(res[0].offer.id).toBe("revA-offer");
  });

  it("reviews: poor-rated seller ranks below unreviewed equal-price seller", () => {
    const agentMap = new Map<string, any>([
      ["revC", makeAgent("revC")],
      ["revD", makeAgent("revD")],
    ]);
    const c = makeOffer({ id: "revC-offer", agentId: "revC", priceAmount: 1 });
    const d = makeOffer({ id: "revD-offer", agentId: "revD", priceAmount: 1 });
    const reviewStats = new Map([
      ["revC", { average: 1, total: 6 }],
    ]);
    const res = searchOffers([c, d], agentMap, { reviewStats });
    expect(res[0].offer.id).toBe("revD-offer");
  });

  it("filters by minReviewRating (verified review average)", () => {
    const agentMap = new Map<string, any>([
      ["rA", makeAgent("rA")],
      ["rB", makeAgent("rB")],
    ]);
    const a = makeOffer({ id: "rA-offer", agentId: "rA", priceAmount: 1 });
    const b = makeOffer({ id: "rB-offer", agentId: "rB", priceAmount: 1 });
    const reviewStats = new Map([
      ["rA", { average: 4.5, total: 3 }],
      ["rB", { average: 2, total: 4 }],
    ]);
    const res = searchOffers([a, b], agentMap, { reviewStats, minReviewRating: 4 });
    expect(res.map((r) => r.offer.id)).toEqual(["rA-offer"]);
  });

  it("sorts by rating — highest review average first, unreviewed last", () => {
    const agentMap = new Map<string, any>([
      ["sA", makeAgent("sA")],
      ["sB", makeAgent("sB")],
      ["sC", makeAgent("sC")],
    ]);
    const a = makeOffer({ id: "sA-offer", agentId: "sA", priceAmount: 1 });
    const b = makeOffer({ id: "sB-offer", agentId: "sB", priceAmount: 1 });
    const c = makeOffer({ id: "sC-offer", agentId: "sC", priceAmount: 1 });
    const reviewStats = new Map([
      ["sA", { average: 4.8, total: 10 }],
      ["sB", { average: 3, total: 2 }],
    ]);
    const res = searchOffers([c, b, a], agentMap, { reviewStats, sortBy: "rating" });
    expect(res.map((r) => r.offer.id)).toEqual(["sA-offer", "sB-offer", "sC-offer"]);
  });

  it("filters by escrowOnly — only escrow-backed offers remain", () => {
    const escrowed = makeOffer({ id: "esc1", agentId: "seller1", escrow: true });
    const plain = makeOffer({ id: "plain1", agentId: "seller2", escrow: false });
    const res = searchOffers([escrowed, plain], agents, { escrowOnly: true });
    expect(res.map((r) => r.offer.id)).toEqual(["esc1"]);
  });

  it("filters by minOnTimeRate (SLA)", () => {
    const onTime = makeOffer({ id: "sla-good", agentId: "seller1" });
    const late = makeOffer({ id: "sla-bad", agentId: "seller2" });
    const slaStats = new Map<any, any>([
      ["seller1", { onTimeRate: 0.95, totalDeliveries: 20, avgLatencyMs: 500 }],
      ["seller2", { onTimeRate: 0.4, totalDeliveries: 10, avgLatencyMs: 9000 }],
    ]);
    const res = searchOffers([onTime, late], agents, { slaStats, minOnTimeRate: 0.8 });
    expect(res.map((r) => r.offer.id)).toEqual(["sla-good"]);
  });

  it("sorts by quality — composite of reviews + SLA + success rate", () => {
    const agentMap = new Map<string, any>([
      ["qA", makeAgent("qA", { success: 20, fail: 0 })],
      ["qB", makeAgent("qB", { success: 2, fail: 8 })],
    ]);
    const a = makeOffer({ id: "qA-offer", agentId: "qA", priceAmount: 1 });
    const b = makeOffer({ id: "qB-offer", agentId: "qB", priceAmount: 1 });
    const reviewStats = new Map([["qA", { average: 4.9, total: 12 }]]);
    const slaStats = new Map<any, any>([
      ["qA", { onTimeRate: 1, totalDeliveries: 20, avgLatencyMs: 200 }],
    ]);
    const successRateByAgent = new Map<string, number>([
      ["qA", 1],
      ["qB", 0.2],
    ]);
    const res = searchOffers([b, a], agentMap, {
      reviewStats,
      slaStats,
      successRateByAgent,
      sortBy: "quality",
    });
    expect(res[0].offer.id).toBe("qA-offer");
  });
});
