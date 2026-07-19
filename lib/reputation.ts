/**
 * Reputation system — scoring, badges, ranking boost.
 *
 * Score formula:
 *   success_rate * 40 + response_speed * 20 + volume * 20 + dispute_free * 20
 *
 * Badges:
 *   ✅ Verified    — wallet funded + 10+ successful orders
 *   🏆 Top Seller  — 100+ sales, 95%+ success
 *   🔒 Escrow Pro  — 50+ escrow releases
 *   🛡️ No Disputes — 0 disputes in 30 days
 */
import type { AgentRecord } from "./types";
import type { EscrowRecord } from "./store-types";

export type ReputationBadge = {
  id: string;
  label: string;
  icon: string;
  description: string;
  earned: boolean;
  /** Ranking boost in percentage points (added to base score) */
  boost: number;
};

export type ReputationScore = {
  /** 0-100 overall score */
  score: number;
  /** Component breakdown */
  components: {
    successRate: { score: number; weight: number; raw: number };
    responseSpeed: { score: number; weight: number; raw: number };
    volume: { score: number; weight: number; raw: number };
    disputeFree: { score: number; weight: number; raw: number };
  };
  /** Earned badges */
  badges: ReputationBadge[];
  /** Total ranking boost from badges (percentage points) */
  rankingBoost: number;
  /** Trust level: 0-4 */
  trustLevel: number;
  /** Summary text for display */
  summary: string;
};

/** Compute reputation score for an agent */
export function computeReputation(
  agent: AgentRecord,
  escrows: EscrowRecord[] = [],
  orderCount: number = 0
): ReputationScore {
  const stats = agent.stats;

  // 1. Success rate (0-100, weight 40)
  const totalTx = stats.success + stats.fail;
  const successRate = totalTx > 0 ? stats.success / totalTx : 0;
  const successScore = Math.round(successRate * 100);

  // 2. Response speed (0-100, weight 20)
  // Lower latency = higher score. 0ms = 100, 5000ms+ = 0
  const avgLatency = stats.success > 0 ? stats.totalLatencyMs / stats.success : 0;
  const speedScore =
    avgLatency === 0
      ? 50 // No data yet — neutral
      : Math.max(0, Math.round(100 - (avgLatency / 5000) * 100));

  // 3. Volume (0-100, weight 20)
  // 100+ sales = 100, scale linearly
  const volumeScore = Math.min(100, stats.sales);

  // 4. Dispute-free (0-100, weight 20)
  // Check escrows for disputes
  const agentEscrows = escrows.filter((e) => e.sellerAgentId === agent.id);
  const disputedCount = agentEscrows.filter((e) => e.status === "disputed").length;
  const disputeFreeRate =
    agentEscrows.length > 0
      ? 1 - disputedCount / agentEscrows.length
      : 1; // No escrows = no disputes = full score
  const disputeScore = Math.round(disputeFreeRate * 100);

  // Weighted total
  const overall =
    successScore * 0.4 +
    speedScore * 0.2 +
    volumeScore * 0.2 +
    disputeScore * 0.2;

  const score = Math.round(Math.min(100, Math.max(0, overall)));

  // Badges
  const badges = computeBadges(agent, escrows, orderCount);
  const rankingBoost = badges
    .filter((b) => b.earned)
    .reduce((sum, b) => sum + b.boost, 0);

  // Trust level (0-4)
  let trustLevel = 0;
  if (score >= 80 && badges.filter((b) => b.earned).length >= 2) trustLevel = 4;
  else if (score >= 60 && badges.filter((b) => b.earned).length >= 1) trustLevel = 3;
  else if (score >= 40) trustLevel = 2;
  else if (score >= 20) trustLevel = 1;

  // Summary
  const summary = generateSummary(agent, score, badges, trustLevel);

  return {
    score,
    components: {
      successRate: { score: successScore, weight: 40, raw: successRate },
      responseSpeed: { score: speedScore, weight: 20, raw: avgLatency },
      volume: { score: volumeScore, weight: 20, raw: stats.sales },
      disputeFree: { score: disputeScore, weight: 20, raw: disputeFreeRate },
    },
    badges,
    rankingBoost,
    trustLevel,
    summary,
  };
}

/** Compute badges for an agent */
function computeBadges(
  agent: AgentRecord,
  escrows: EscrowRecord[],
  orderCount: number
): ReputationBadge[] {
  const stats = agent.stats;
  const totalTx = stats.success + stats.fail;
  const successRate = totalTx > 0 ? stats.success / totalTx : 0;
  const agentEscrows = escrows.filter((e) => e.sellerAgentId === agent.id);
  const releasedEscrows = agentEscrows.filter((e) => e.status === "released").length;
  const disputedEscrows = agentEscrows.filter((e) => e.status === "disputed").length;

  return [
    {
      id: "verified",
      label: "Verified",
      icon: "✅",
      description: "Wallet funded + 10+ successful orders",
      earned: orderCount >= 10 && Boolean(agent.walletAccountId),
      boost: 10,
    },
    {
      id: "top_seller",
      label: "Top Seller",
      icon: "🏆",
      description: "100+ sales, 95%+ success rate",
      earned: stats.sales >= 100 && successRate >= 0.95,
      boost: 20,
    },
    {
      id: "escrow_pro",
      label: "Escrow Pro",
      icon: "🔒",
      description: "50+ escrow releases",
      earned: releasedEscrows >= 50,
      boost: 15,
    },
    {
      id: "no_disputes",
      label: "No Disputes",
      icon: "🛡️",
      description: "0 disputes in lifetime",
      earned: disputedEscrows === 0 && agentEscrows.length >= 5,
      boost: 5,
    },
  ];
}

/** Generate human-readable summary */
function generateSummary(
  agent: AgentRecord,
  score: number,
  badges: ReputationBadge[],
  trustLevel: number
): string {
  const earnedBadges = badges.filter((b) => b.earned);
  const badgeText = earnedBadges.length > 0
    ? earnedBadges.map((b) => `${b.icon} ${b.label}`).join(", ")
    : "No badges yet";

  const trustLabels = [
    "New",
    "Building",
    "Established",
    "Trusted",
    "Elite",
  ];

  return `${agent.name} — Trust: ${trustLabels[trustLevel]} | Score: ${score}/100 | ${badgeText}`;
}

/** Get reputation for API response (lighter format) */
export function reputationForApi(
  agent: AgentRecord,
  escrows: EscrowRecord[] = [],
  orderCount: number = 0
) {
  const rep = computeReputation(agent, escrows, orderCount);
  return {
    score: rep.score,
    trustLevel: rep.trustLevel,
    trustLabel: ["New", "Building", "Established", "Trusted", "Elite"][rep.trustLevel],
    badges: rep.badges.map((b) => ({
      id: b.id,
      label: b.label,
      icon: b.icon,
      earned: b.earned,
    })),
    rankingBoost: rep.rankingBoost,
    components: {
      successRate: rep.components.successRate.score,
      responseSpeed: rep.components.responseSpeed.score,
      volume: rep.components.volume.score,
      disputeFree: rep.components.disputeFree.score,
    },
    summary: rep.summary,
  };
}
