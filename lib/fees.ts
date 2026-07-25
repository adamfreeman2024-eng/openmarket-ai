/**
 * Tiered Fee System — volume-based fee structure.
 * 
 * Sellers who do more volume get lower fees.
 * 
 * Tiers:
 *   Free:     0-10 sales/month    → 2% fee (default)
 *   Starter:  11-50 sales/month   → 1.5% fee
 *   Pro:      51-200 sales/month  → 1% fee
 *   Enterprise: 200+ sales/month  → 0.5% fee
 * 
 * Premium subscriptions (monthly):
 *   Basic:   $9/mo  → 1% fee + boosted visibility
 *   Pro:     $29/mo → 0.5% fee + analytics + priority support
 *   Enterprise: $99/mo → 0.25% fee + custom rules + API access
 */

import { db } from "./store";
import { log } from "./logger";
import { PLATFORM_FEE_BPS } from "./config";

export type FeeTier = {
  name: string;
  minSales: number;
  maxSales: number | null;
  feeBps: number; // basis points (100 = 1%)
  label: string;
};

export const FEE_TIERS: FeeTier[] = [
  {
    name: "free",
    minSales: 0,
    maxSales: 10,
    feeBps: PLATFORM_FEE_BPS, // default 2%
    label: "Free — 2% fee",
  },
  {
    name: "starter",
    minSales: 11,
    maxSales: 50,
    feeBps: 150, // 1.5%
    label: "Starter — 1.5% fee",
  },
  {
    name: "pro",
    minSales: 51,
    maxSales: 200,
    feeBps: 100, // 1%
    label: "Pro — 1% fee",
  },
  {
    name: "enterprise",
    minSales: 201,
    maxSales: null,
    feeBps: 50, // 0.5%
    label: "Enterprise — 0.5% fee",
  },
];

export type PremiumSubscription = {
  agentId: string;
  plan: "free" | "basic" | "pro" | "enterprise";
  startedAt: string;
  expiresAt?: string;
  monthlyFeeUsd: number;
  feeBpsOverride: number;
  features: string[];
};

const subscriptions = new Map<string, PremiumSubscription>();

export const PREMIUM_PLANS = {
  free: {
    plan: "free" as const,
    monthlyFeeUsd: 0,
    feeBpsOverride: PLATFORM_FEE_BPS,
    features: ["Standard listing", "2% transaction fee"],
  },
  basic: {
    plan: "basic" as const,
    monthlyFeeUsd: 9,
    feeBpsOverride: 100, // 1%
    features: ["Standard listing", "1% transaction fee", "Boosted visibility (1.2x)"],
  },
  pro: {
    plan: "pro" as const,
    monthlyFeeUsd: 29,
    feeBpsOverride: 50, // 0.5%
    features: ["Standard listing", "0.5% transaction fee", "Boosted visibility (1.5x)", "Analytics dashboard", "Priority support"],
  },
  enterprise: {
    plan: "enterprise" as const,
    monthlyFeeUsd: 99,
    feeBpsOverride: 25, // 0.25%
    features: ["Standard listing", "0.25% transaction fee", "Boosted visibility (2x)", "Advanced analytics", "Custom rules", "API access", "Dedicated support"],
  },
};

/** Get the current fee tier for an agent based on monthly sales volume */
export function getFeeTier(agentId: string): FeeTier {
  const agent = db.getAgent(agentId);
  if (!agent) return FEE_TIERS[0];

  const monthlySales = agent.stats.sales; // simplified: in production, calculate per-month
  const tier = FEE_TIERS.find(
    (t) =>
      monthlySales >= t.minSales &&
      (t.maxSales === null || monthlySales <= t.maxSales)
  );
  return tier || FEE_TIERS[0];
}

/** Get the effective fee rate for an agent (tier-based + premium override) */
export function getEffectiveFeeBps(agentId: string): number {
  // Check if agent has a premium subscription
  const sub = subscriptions.get(agentId);
  if (sub && sub.expiresAt && new Date(sub.expiresAt) > new Date()) {
    return sub.feeBpsOverride;
  }

  // Fall back to volume-based tier
  const tier = getFeeTier(agentId);
  return tier.feeBps;
}

/** Subscribe an agent to a premium plan */
export function subscribe(
  agentId: string,
  plan: "basic" | "pro" | "enterprise"
): PremiumSubscription {
  const planConfig = PREMIUM_PLANS[plan];
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const sub: PremiumSubscription = {
    agentId,
    plan,
    startedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    monthlyFeeUsd: planConfig.monthlyFeeUsd,
    feeBpsOverride: planConfig.feeBpsOverride,
    features: planConfig.features,
  };

  subscriptions.set(agentId, sub);
  log.info({ agentId, plan, feeBps: sub.feeBpsOverride }, "Agent subscribed to premium plan");

  return sub;
}

/** Get agent's subscription info */
export function getSubscription(agentId: string): PremiumSubscription | null {
  const sub = subscriptions.get(agentId);
  if (!sub) return null;
  if (sub.expiresAt && new Date(sub.expiresAt) < new Date()) {
    subscriptions.delete(agentId);
    return null;
  }
  return sub;
}

/** Get visibility boost multiplier for an agent */
export function getVisibilityBoost(agentId: string): number {
  const sub = getSubscription(agentId);
  if (!sub) return 1.0;
  switch (sub.plan) {
    case "basic":
      return 1.2;
    case "pro":
      return 1.5;
    case "enterprise":
      return 2.0;
    default:
      return 1.0;
  }
}

/** Calculate fee for a transaction */
export function calculateFee(
  agentId: string,
  amount: number
): { feeBps: number; feeAmount: number; sellerAmount: number; tier: string } {
  const feeBps = getEffectiveFeeBps(agentId);
  const feeAmount = (amount * feeBps) / 10000;
  const sellerAmount = amount - feeAmount;
  const tier = getFeeTier(agentId);

  return {
    feeBps,
    feeAmount,
    sellerAmount,
    tier: tier.name,
  };
}
