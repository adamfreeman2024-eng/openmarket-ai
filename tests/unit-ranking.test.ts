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
});
