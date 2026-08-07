import type { AgentRecord, OfferRecord } from "./types";
import { PLATFORM_FEE_BPS } from "./config";
import type { EscrowRecord } from "./store-types";
import { computeReputation } from "./reputation";

/** Review quality signal — average 1..5 + verified review count. */
export type ReviewQuality = { average: number; total: number };

/** SLA signal — on-time delivery rate (0..1) + avg latency. */
export type SLASignal = { onTimeRate: number; totalDeliveries: number; avgLatencyMs: number };

/** Quality composite — reviews + SLA + success rate (0..1 normalized). */
export function qualityScore(opts: {
  reviews?: ReviewQuality;
  sla?: SLASignal;
  successRate?: number | null;
}): number {
  let s = 0;
  if (opts.reviews && opts.reviews.total > 0) {
    const confidence = Math.min(opts.reviews.total / 5, 1);
    s += 0.4 * ((opts.reviews.average / 5) * confidence);
  }
  if (opts.sla && opts.sla.totalDeliveries > 0) {
    s += 0.3 * opts.sla.onTimeRate;
  }
  if (opts.successRate != null) {
    s += 0.3 * opts.successRate;
  }
  return s;
}

/** Agent-oriented ranking — higher is better.
 *  Now includes reputation boost from badges + verified review quality (V2). */
export function rankOffer(
  offer: OfferRecord,
  seller: AgentRecord | undefined,
  opts?: {
    maxPrice?: number;
    capability?: string;
    escrows?: EscrowRecord[];
    orderCount?: number;
    text?: string;
    reviews?: ReviewQuality;
  }
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

  // Cold-start protection — new sellers (few orders) get a small visibility nudge
  // so the marketplace doesn't drown them with zero-history penalty.
  if (total < 3) score += 0.05;
  if (opts?.capability && offer.capability === opts.capability) score += 0.2;
  if (opts?.maxPrice != null && offer.priceAmount > opts.maxPrice) score -= 1;
  if (!offer.active) score -= 10;

  // Paid visibility boost — active boosted listings rank ~2x higher
  if (offer.boostedUntil && new Date(offer.boostedUntil).getTime() > Date.now()) {
    score += 0.5;
  }

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

  // Verified review quality boost (Reputation V2) — quality-based discovery.
  // A 5.0★ seller with ≥5 verified reviews ranks above an equal-priced unknown.
  // Weight: up to +0.3 for excellent reviews; negative reviews penalize.
  if (opts?.reviews && opts.reviews.total > 0) {
    const confidence = Math.min(opts.reviews.total / 5, 1); // 5+ reviews = full weight
    const quality = ((opts.reviews.average - 3) / 2) * 0.3 * confidence; // -0.3..+0.3
    score += quality;
    // Small trust nudge for having any verified reviews at all
    score += 0.05 * confidence;
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
    sortBy?: "relevance" | "price_low" | "price_high" | "reputation" | "speed" | "rating" | "quality";
    minRating?: number;
    minReviewRating?: number;
    minOnTimeRate?: number;
    escrowOnly?: boolean;
    reviewStats?: Map<string, ReviewQuality>;
    slaStats?: Map<string, SLASignal>;
    successRateByAgent?: Map<string, number>;
  }
) {
  const text = (q.q || "").toLowerCase().trim();
  let list = offers.filter((o) => o.active);
  if (q.escrowOnly) {
    list = list.filter((o) => o.escrow);
  }
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

  // Min review rating filter — verified user-review average (1..5), e.g. 4.0
  if (q.minReviewRating != null && q.minReviewRating > 0) {
    list = list.filter((o) => {
      const rev = q.reviewStats?.get(o.agentId);
      if (!rev || rev.total === 0) return true; // unreviewed sellers pass (mild prior)
      return rev.average >= q.minReviewRating!;
    });
  }

  // Min SLA / on-time delivery rate filter (0..1), e.g. 0.9 = 90% on time
  if (q.minOnTimeRate != null && q.minOnTimeRate > 0) {
    list = list.filter((o) => {
      const sla = q.slaStats?.get(o.agentId);
      if (!sla || sla.totalDeliveries === 0) return true; // unknown sellers pass
      return sla.onTimeRate >= q.minOnTimeRate!;
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
          reviews: q.reviewStats?.get(o.agentId),
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
  } else if (sortBy === "rating") {
    // Verified review average (V2) — highest quality first; unreviewed at bottom.
    scored.sort((a, b) => {
      const aRev = q.reviewStats?.get(a.offer.agentId);
      const bRev = q.reviewStats?.get(b.offer.agentId);
      const aAvg = aRev && aRev.total > 0 ? aRev.average : -1;
      const bAvg = bRev && bRev.total > 0 ? bRev.average : -1;
      if (bAvg !== aAvg) return bAvg - aAvg;
      const aCount = aRev?.total ?? 0;
      const bCount = bRev?.total ?? 0;
      return bCount - aCount;
    });
  } else if (sortBy === "quality") {
    // Quality composite — reviews + SLA + success rate (Phase 3.1).
    scored.sort((a, b) => {
      const aQ = qualityScore({
        reviews: q.reviewStats?.get(a.offer.agentId),
        sla: q.slaStats?.get(a.offer.agentId),
        successRate: q.successRateByAgent?.get(a.offer.agentId),
      });
      const bQ = qualityScore({
        reviews: q.reviewStats?.get(b.offer.agentId),
        sla: q.slaStats?.get(b.offer.agentId),
        successRate: q.successRateByAgent?.get(b.offer.agentId),
      });
      if (bQ !== aQ) return bQ - aQ;
      return b.score - a.score; // tie-break by relevance
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
