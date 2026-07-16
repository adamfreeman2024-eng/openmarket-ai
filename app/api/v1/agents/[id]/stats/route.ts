import { json, options } from "@/lib/http";
import { db, ensureSeedCatalog } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/agents/:id/stats — public reputation for ranking agents */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const agent = db.getAgent(id);
  if (!agent) return json({ ok: false, error: "Not found" }, 404);

  const total = agent.stats.success + agent.stats.fail;
  const successRate = total === 0 ? null : agent.stats.success / total;
  const avgLatencyMs =
    agent.stats.success > 0
      ? Math.round(agent.stats.totalLatencyMs / agent.stats.success)
      : null;

  const offers = db
    .listOffers()
    .filter((o) => o.agentId === id)
    .map((o) => ({
      id: o.id,
      capability: o.capability,
      priceAmount: o.priceAmount,
      priceAsset: o.priceAsset,
      escrow: o.escrow,
    }));

  return json({
    ok: true,
    agentId: agent.id,
    name: agent.name,
    capabilities: agent.capabilities,
    reputation: {
      sales: agent.stats.sales,
      purchases: agent.stats.purchases,
      success: agent.stats.success,
      fail: agent.stats.fail,
      successRate,
      avgLatencyMs,
    },
    openOffers: offers,
  });
}
