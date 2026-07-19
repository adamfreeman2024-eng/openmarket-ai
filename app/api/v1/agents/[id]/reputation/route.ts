import { NextRequest } from "next/server";
import { db, ensureSeedCatalog } from "@/lib/store";
import { json, options } from "@/lib/http";
import { reputationForApi } from "@/lib/reputation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/agents/:id/reputation — public reputation profile */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const agent = db.getAgent(id);
  if (!agent) return json({ ok: false, error: "Agent not found" }, 404);

  const escrows = db.listEscrows();
  const orders = db.listOrders().filter((o) => o.sellerAgentId === id);
  const orderCount = orders.length;
  const completedOrders = orders.filter((o) => o.status === "completed");

  const rep = reputationForApi(agent, escrows, orderCount);

  return json({
    ok: true,
    agent: {
      id: agent.id,
      name: agent.name,
      walletAccountId: agent.walletAccountId,
      capabilities: agent.capabilities,
      createdAt: agent.createdAt,
      stats: agent.stats,
    },
    reputation: rep,
    orders: {
      total: orderCount,
      completed: completedOrders.length,
      recent: completedOrders.slice(-10).reverse().map((o) => ({
        id: o.id,
        status: o.status,
        priceAsset: o.priceAsset,
        totalAmount: o.totalAmount,
        createdAt: o.createdAt,
        completedAt: o.completedAt,
        latencyMs: o.latencyMs,
      })),
    },
    escrows: {
      total: escrows.filter((e) => e.sellerAgentId === id).length,
      released: escrows.filter((e) => e.sellerAgentId === id && e.status === "released").length,
      disputed: escrows.filter((e) => e.sellerAgentId === id && e.status === "disputed").length,
      refunded: escrows.filter((e) => e.sellerAgentId === id && e.status === "refunded").length,
    },
  });
}
