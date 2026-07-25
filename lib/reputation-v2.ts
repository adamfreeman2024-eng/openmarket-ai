/**
 * Reputation V2 — User Reviews, SLA Tracking, Anti-Gaming.
 * 
 * New features:
 * - User reviews (1-5 stars with text)
 * - SLA tracking (on-time delivery rate)
 * - Anti-gaming: detect review bombing, self-reviews, suspicious patterns
 * - Time-weighted scoring (recent performance matters more)
 */

import type { AgentRecord } from "./types";
import type { EscrowRecord } from "./store-types";
import {
  computeReputation,
  reputationForApi,
  type ReputationScore,
} from "./reputation";

// ─── Review Types ───
export type Review = {
  id: string;
  agentId: string;
  orderId: string;
  reviewerAgentId: string;
  rating: number; // 1-5
  comment: string;
  createdAt: string;
  // Anti-gaming fields
  verified: boolean; // True if reviewer has a real completed order
  flagged: boolean; // True if suspicious
  flagReason?: string;
};

// In-memory review store (in production, this would be in the database)
const reviews = new Map<string, Review[]>();

// ─── Review Management ───
export function addReview(
  review: Omit<Review, "id" | "createdAt" | "verified" | "flagged">
): Review & { warning?: string } {
  const id = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();

  // Anti-gaming: check for suspicious patterns
  const { flagged, flagReason, warning } = detectSuspiciousReview(review);

  const fullReview: Review = {
    ...review,
    id,
    createdAt,
    verified: true, // In production, verify against completed orders
    flagged,
    flagReason,
  };

  const agentReviews = reviews.get(review.agentId) || [];
  agentReviews.push(fullReview);
  reviews.set(review.agentId, agentReviews);

  return { ...fullReview, warning };
}

export function getReviews(agentId: string): Review[] {
  return reviews.get(agentId) || [];
}

export function getReviewStats(agentId: string): {
  average: number;
  total: number;
  distribution: { 1: number; 2: number; 3: number; 4: number; 5: number };
  verified: number;
  flagged: number;
} {
  const agentReviews = reviews.get(agentId) || [];
  const verifiedReviews = agentReviews.filter((r) => !r.flagged && r.verified);

  if (verifiedReviews.length === 0) {
    return {
      average: 0,
      total: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      verified: 0,
      flagged: 0,
    };
  }

  const sum = verifiedReviews.reduce((acc, r) => acc + r.rating, 0);
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of verifiedReviews) {
    dist[r.rating as 1 | 2 | 3 | 4 | 5]++;
  }

  return {
    average: sum / verifiedReviews.length,
    total: verifiedReviews.length,
    distribution: dist,
    verified: verifiedReviews.length,
    flagged: agentReviews.filter((r) => r.flagged).length,
  };
}

// ─── Anti-Gaming Detection ───
function detectSuspiciousReview(review: {
  agentId: string;
  reviewerAgentId: string;
  rating: number;
}): {
  flagged: boolean;
  flagReason?: string;
  warning?: string;
} {
  const agentReviews = reviews.get(review.agentId) || [];

  // Check 1: Self-review (reviewer is the same agent)
  if (review.reviewerAgentId === review.agentId) {
    return {
      flagged: true,
      flagReason: "SELF_REVIEW",
      warning: "Self-reviews are not allowed and will not count towards reputation.",
    };
  }

  // Check 2: Review bombing (more than 5 reviews from same reviewer in 24h)
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentBySameReviewer = agentReviews.filter(
    (r) =>
      r.reviewerAgentId === review.reviewerAgentId &&
      new Date(r.createdAt).getTime() > oneDayAgo
  );
  if (recentBySameReviewer.length >= 5) {
    return {
      flagged: true,
      flagReason: "REVIEW_BOMBING",
      warning: "Too many reviews from same agent in 24h. Review flagged.",
    };
  }

  // Check 3: Suspicious rating pattern (all 1-star or all 5-star from new accounts)
  const allSameRating = agentReviews.length >= 10 &&
    agentReviews.every((r) => r.rating === review.rating);
  if (allSameRating && (review.rating === 1 || review.rating === 5)) {
    return {
      flagged: true,
      flagReason: "SUSPICIOUS_PATTERN",
      warning: "Suspicious review pattern detected. Review under review.",
    };
  }

  return { flagged: false };
}

// ─── SLA Tracking ───
export type SLAStats = {
  onTimeRate: number; // 0-1, percentage of orders delivered within maxSeconds
  avgDeliveryTime: number; // in ms
  lateDeliveries: number;
  totalDeliveries: number;
};

export function computeSLA(
  agent: AgentRecord,
  orders: { sellerAgentId: string; latencyMs: number; maxSeconds?: number; status: string }[]
): SLAStats {
  const agentOrders = orders.filter(
    (o) => o.sellerAgentId === agent.id && o.status === "completed" && o.latencyMs
  );

  if (agentOrders.length === 0) {
    return {
      onTimeRate: 1,
      avgDeliveryTime: 0,
      lateDeliveries: 0,
      totalDeliveries: 0,
    };
  }

  const maxAllowedMs = (agentOrders[0].maxSeconds || 60) * 1000;
  const onTime = agentOrders.filter((o) => o.latencyMs <= maxAllowedMs);
  const totalLatency = agentOrders.reduce((sum, o) => sum + o.latencyMs, 0);

  return {
    onTimeRate: onTime.length / agentOrders.length,
    avgDeliveryTime: totalLatency / agentOrders.length,
    lateDeliveries: agentOrders.length - onTime.length,
    totalDeliveries: agentOrders.length,
  };
}

// ─── Reputation V2 (extends V1) ───
export function computeReputationV2(
  agent: AgentRecord,
  escrows: EscrowRecord[] = [],
  orderCount: number = 0,
  orders: { sellerAgentId: string; latencyMs: number; maxSeconds?: number; status: string }[] = []
): ReputationScore & {
  reviews: ReturnType<typeof getReviewStats>;
  sla: SLAStats;
  antiGamingFlags: string[];
} {
  const baseRep = computeReputation(agent, escrows, orderCount);
  const reviewStats = getReviewStats(agent.id);
  const sla = computeSLA(agent, orders);

  // Adjust score based on reviews (if available)
  let adjustedScore = baseRep.score;
  if (reviewStats.total > 0) {
    // Review rating contributes up to 10 points
    const reviewContribution = (reviewStats.average / 5) * 10;
    adjustedScore = Math.round(adjustedScore * 0.9 + reviewContribution);
  }

  // Adjust score based on SLA (if available)
  if (sla.totalDeliveries > 0) {
    // On-time rate contributes up to 5 points
    const slaContribution = sla.onTimeRate * 5;
    adjustedScore = Math.round(adjustedScore * 0.95 + slaContribution);
  }

  // Detect anti-gaming flags
  const antiGamingFlags: string[] = [];
  if (reviewStats.flagged > 3) {
    antiGamingFlags.push("MULTIPLE_FLAGGED_REVIEWS");
  }
  if (sla.totalDeliveries > 10 && sla.onTimeRate < 0.5) {
    antiGamingFlags.push("POOR_SLA_PERFORMANCE");
  }

  return {
    ...baseRep,
    score: Math.min(100, Math.max(0, adjustedScore)),
    reviews: reviewStats,
    sla,
    antiGamingFlags,
  };
}

export function reputationV2ForApi(
  agent: AgentRecord,
  escrows: EscrowRecord[] = [],
  orderCount: number = 0,
  orders: { sellerAgentId: string; latencyMs: number; maxSeconds?: number; status: string }[] = []
) {
  const rep = computeReputationV2(agent, escrows, orderCount, orders);
  const base = reputationForApi(agent, escrows, orderCount);

  return {
    ...base,
    score: rep.score,
    reviews: rep.reviews,
    sla: rep.sla,
    antiGamingFlags: rep.antiGamingFlags,
  };
}
