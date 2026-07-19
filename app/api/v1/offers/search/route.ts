import { NextRequest } from "next/server";
import { db, ensureSeedCatalog } from "@/lib/store";
import { searchOffers } from "@/lib/ranking";
import { json, options } from "@/lib/http";
import { reputationForApi } from "@/lib/reputation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/offers/search?q=&capability=&maxPrice=&asset=&limit= */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const sp = req.nextUrl.searchParams;
  const agents = new Map(db.listAgents().map((a) => [a.id, a]));
  const escrows = db.listEscrows();

  // Count orders per agent for reputation
  const ordersByAgent = new Map<string, number>();
  for (const o of db.listOrders()) {
    if (o.sellerAgentId) {
      ordersByAgent.set(o.sellerAgentId, (ordersByAgent.get(o.sellerAgentId) ?? 0) + 1);
    }
  }

  const results = searchOffers(db.listOffers(), agents, {
    q: sp.get("q") || undefined,
    capability: sp.get("capability") || undefined,
    maxPrice: sp.get("maxPrice") ? Number(sp.get("maxPrice")) : undefined,
    asset: sp.get("asset") || undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : 20,
    escrows,
    ordersByAgent,
  });

  return json({
    ok: true,
    count: results.length,
    results: results.map((r) => {
      const orderCount = ordersByAgent.get(r.offer.agentId) ?? 0;
      const rep = r.seller
        ? reputationForApi(r.seller, escrows, orderCount)
        : null;
      return {
        score: Number(r.score.toFixed(6)),
        offer: r.offer,
        seller: r.seller
          ? {
              id: r.seller.id,
              name: r.seller.name,
              successRate:
                r.seller.stats.success + r.seller.stats.fail === 0
                  ? null
                  : r.seller.stats.success /
                    (r.seller.stats.success + r.seller.stats.fail),
              reputation: rep,
            }
          : null,
      };
    }),
  });
}
