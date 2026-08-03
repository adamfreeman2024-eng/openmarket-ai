import type { AgentRecord, OfferRecord } from "./types";
import { PLATFORM_FEE_BPS } from "./config";
import type { EscrowRecord } from "./store-types";
import { computeReputation } from "./reputation";

/** Agent-oriented ranking — higher is better.
 *  Now includes reputation boost from badges. */
export function rankOffer(
  offer: OfferRecord,
  seller: AgentRecord | undefined,
  opts?: { maxPrice?: number; capability?: string; escrows?: EscrowRecord[]; orderCount?: number; text?: string }
): number {
  const sales = seller?.stats.sales ?? 0;
  const success = seller?.stats.success ?? 0;
  const fail = seller?.stats.fail ?? 0;
  const total = success + fail;
  const successRate = total === 0 ? 0.8 : success / total; // mild prior
  const avgLatency =
    success > 0 ? (seller?.stats.totalLatencyMs ?? 1000) / success : 2000;

  let score = 0;
  // cheaper better (normalized roughly)
  score += 0.3 * (1 / (offer.priceAmount + 0.01));
  score += 0.25 * successRate;
  score += 0.15 * (1 / (avgLatency / 1000 + 0.1));
  score += 0.1 * Math.min(sales / 10, 1);
  score -= 0.05 * (PLATFORM_FEE_BPS / 10000);
  if (opts?.capability && offer.capability === opts.capability) score += 0.2;
  if (opts?.maxPrice != null && offer.priceAmount > opts.maxPrice) score -= 1;
  if (!offer.active) score -= 10;

  // Text relevance boost: title match > tag match > description match.
  if (opts?.text) {
    const t = opts.text.toLowerCase();
    const title = (offer.title || "").toLowerCase();
    const desc = (offer.description || "").toLowerCase();
    const cap = (offer.capability || "").toLowerCase();
    if (title.includes(t)) score += 0.35;
    else if (offer.tags.some((tag) => tag.toLowerCase().includes(t))) score += 0.25;
    else if (desc.includes(t) || cap.includes(t)) score += 0.15;
  }

  // Reputation boost: add badge boost as percentage of base score
  if (seller && opts?.escrows) {
    const rep = computeReputation(seller, opts.escrows, opts.orderCount ?? 0);
    // Boost: up to +50% of base score from badges
    score *= 1 + rep.rankingBoost / 100;
  }

  return score;
}

export function searchOffers(
  offers: OfferRecord[],
  agents: Map<string, AgentRecord>,
  q: {
    q?: string;
    capability?: string;
    maxPrice?: number;
    asset?: string;
    limit?: number;
    escrows?: EscrowRecord[];
    ordersByAgent?: Map<string, number>;
    tags?: string[];
    category?: string;
    sortBy?: "relevance" | "price_low" | "price_high" | "reputation" | "speed";
    minRating?: number;
  }
) {
  const text = (q.q || "").toLowerCase().trim();
  let list = offers.filter((o) => o.active);
  if (q.capability) {
    list = list.filter(
      (o) =>
        o.capability === q.capability ||
        o.tags.includes(q.capability!) ||
        o.capability.includes(q.capability!)
    );
  }
  if (q.asset) list = list.filter((o) => o.priceAsset === q.asset);
  if (q.maxPrice != null)
    list = list.filter((o) => o.priceAmount <= q.maxPrice!);
  if (text) {
    list = list.filter(
      (o) =>
        o.title.toLowerCase().includes(text) ||
        o.description?.toLowerCase().includes(text) ||
        o.capability.toLowerCase().includes(text) ||
        o.tags.some((t) => t.includes(text))
    );
  }
  // Tag filtering
  if (q.tags && q.tags.length > 0) {
    list = list.filter((o) =>
      q.tags!.some((tag) => o.tags.includes(tag))
    );
  }
  // Category filtering (capability prefix match, e.g. "legal", "security", "text", "code")
  if (q.category) {
    list = list.filter(
      (o) => o.capability.startsWith(q.category!) || o.tags.includes(q.category!)
    );
  }
  // Min rating filter — success rate threshold (0..1), e.g. 0.9 = 90% success
  if (q.minRating != null && q.minRating > 0) {
    list = list.filter((o) => {
      const seller = agents.get(o.agentId);
      const success = seller?.stats.success ?? 0;
      const fail = seller?.stats.fail ?? 0;
      const total = success + fail;
      if (total === 0) return true; // unknown sellers pass (mild prior)
      return success / total >= q.minRating!;
    });
  }

  const scored = list
    .map((o) => {
      const seller = agents.get(o.agentId);
      const orderCount = q.ordersByAgent?.get(o.agentId) ?? 0;
      return {
        offer: o,
        score: rankOffer(o, seller, {
          maxPrice: q.maxPrice,
          capability: q.capability,
          escrows: q.escrows,
          orderCount,
          text: text || undefined,
        }),
        seller,
      };
    });

  // Sort by requested method
  const sortBy = q.sortBy || "relevance";
  if (sortBy === "price_low") {
    scored.sort((a, b) => a.offer.priceAmount - b.offer.priceAmount);
  } else if (sortBy === "price_high") {
    scored.sort((a, b) => b.offer.priceAmount - a.offer.priceAmount);
  } else if (sortBy === "reputation") {
    scored.sort((a, b) => {
      const aRep = a.seller ? a.seller.stats.success : 0;
      const bRep = b.seller ? b.seller.stats.success : 0;
      return bRep - aRep;
    });
  } else if (sortBy === "speed") {
    scored.sort((a, b) => {
      const aSpeed = a.seller && a.seller.stats.success > 0
        ? a.seller.stats.totalLatencyMs / a.seller.stats.success
        : 999999;
      const bSpeed = b.seller && b.seller.stats.success > 0
        ? b.seller.stats.totalLatencyMs / b.seller.stats.success
        : 999999;
      return aSpeed - bSpeed;
    });
  } else {
    // Default: relevance (score-based)
    scored.sort((a, b) => b.score - a.score);
  }

  return scored.slice(0, q.limit ?? 20);
}
