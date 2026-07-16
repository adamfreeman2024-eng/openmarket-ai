import { NextRequest } from "next/server";
import { db, ensureSeedCatalog } from "@/lib/store";
import { searchOffers } from "@/lib/ranking";
import { json, options } from "@/lib/http";

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
  const results = searchOffers(db.listOffers(), agents, {
    q: sp.get("q") || undefined,
    capability: sp.get("capability") || undefined,
    maxPrice: sp.get("maxPrice") ? Number(sp.get("maxPrice")) : undefined,
    asset: sp.get("asset") || undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : 20,
  });
  return json({
    ok: true,
    count: results.length,
    results: results.map((r) => ({
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
          }
        : null,
    })),
  });
}
