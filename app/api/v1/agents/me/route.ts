import { NextRequest } from "next/server";
import { ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/agents/me — current agent from X-Api-Key */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;
  return json({
    ok: true,
    agent: {
      id: agent.id,
      name: agent.name,
      walletAccountId: agent.walletAccountId,
      capabilities: agent.capabilities,
      homepage: agent.homepage,
      webhookUrl: agent.webhookUrl,
      policy: {
        dailySpendLimit: agent.policy.dailySpendLimit,
        maxPerTx: agent.policy.maxPerTx,
        spentToday: agent.policy.spentToday,
        spentDay: agent.policy.spentDay,
      },
      stats: agent.stats,
      createdAt: agent.createdAt,
    },
  });
}
