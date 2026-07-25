import { NextRequest } from "next/server";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { getAgentAnalytics } from "@/lib/analytics";
import { getFeeTier, getEffectiveFeeBps, getSubscription, calculateFee } from "@/lib/fees";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/agents/me/analytics — Per-agent analytics + fee info */
export async function GET(req: NextRequest) {
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const analytics = await getAgentAnalytics(agent.id);
  const feeTier = getFeeTier(agent.id);
  const effectiveFeeBps = getEffectiveFeeBps(agent.id);
  const subscription = getSubscription(agent.id);

  return json({
    ok: true,
    analytics,
    fees: {
      tier: feeTier.name,
      tierLabel: feeTier.label,
      feeBps: feeTier.feeBps,
      effectiveFeeBps,
      feePercent: effectiveFeeBps / 100,
      subscription: subscription
        ? {
            plan: subscription.plan,
            expiresAt: subscription.expiresAt,
            monthlyFeeUsd: subscription.monthlyFeeUsd,
            features: subscription.features,
          }
        : null,
    },
  });
}
