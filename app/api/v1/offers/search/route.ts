import { NextRequest } from "next/server";
import { db, ensureSeedCatalog } from "@/lib/store";
import { searchOffers } from "@/lib/ranking";
import { json, options } from "@/lib/http";
import { reputationForApi } from "@/lib/reputation";
import { getReviewStats } from "@/lib/reputation-v2";
import { publicOffer } from "@/lib/public-dto";
import { cache, searchCacheKey } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/offers/search?q=&capability=&maxPrice=&asset=&limit=&tags=&category=&sortBy=&minRating=&minReviewRating= */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const sp = req.nextUrl.searchParams;

  // Redis cache (in-memory fallback) — ranked discovery results are cached briefly
  // so repeated agent queries don't re-rank the whole catalog every time.
  const cacheKey = searchCacheKey("offers:search", sp);
  const cached = await cache.get<unknown>(cacheKey);
  if (cached) return json(cached);

  const agents = new Map(db.listAgents().map((a) => [a.id, a]));
  const escrows = db.listEscrows();

  // Count orders per agent for reputation
  const ordersByAgent = new Map<string, number>();
  for (const o of db.listOrders()) {
    if (o.sellerAgentId) {
      ordersByAgent.set(o.sellerAgentId, (ordersByAgent.get(o.sellerAgentId) ?? 0) + 1);
    }
  }

  // Parse tags (comma-separated)
  const tagsParam = sp.get("tags");
  const tags = tagsParam ? tagsParam.split(",").map(t => t.trim()).filter(Boolean) : undefined;

  // Review quality per seller agent (Reputation V2) — verified reviews only.
  const reviewStats = new Map<string, { average: number; total: number }>();
  for (const a of db.listAgents()) {
    const s = getReviewStats(a.id);
    if (s.total > 0) reviewStats.set(a.id, { average: s.average, total: s.total });
  }

  const results = searchOffers(db.listOffers(), agents, {
    q: sp.get("q") || undefined,
    capability: sp.get("capability") || undefined,
    maxPrice: sp.get("maxPrice") ? Number(sp.get("maxPrice")) : undefined,
    asset: sp.get("asset") || undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : 20,
    escrows,
    ordersByAgent,
    tags,
    category: sp.get("category") || undefined,
    sortBy: (sp.get("sortBy") as "relevance" | "price_low" | "price_high" | "reputation" | "speed" | "rating") || undefined,
    minRating: sp.get("minRating") ? Number(sp.get("minRating")) : undefined,
    minReviewRating: sp.get("minReviewRating") ? Number(sp.get("minReviewRating")) : undefined,
    reviewStats,
  });

  const payload = {
    ok: true,
    count: results.length,
    results: results.map((r) => {
      const orderCount = ordersByAgent.get(r.offer.agentId) ?? 0;
      const rep = r.seller
        ? reputationForApi(r.seller, escrows, orderCount)
        : null;
      return {
        score: Number(r.score.toFixed(6)),
        offer: publicOffer(r.offer),
        seller: r.seller
          ? {
              id: r.seller.id,
              name: r.seller.name,
              verificationStatus: r.seller.verificationStatus || "bronze",
              githubHandle: r.seller.githubHandle || undefined,
              successRate:
                r.seller.stats.success + r.seller.stats.fail === 0
                  ? null
                  : r.seller.stats.success /
                    (r.seller.stats.success + r.seller.stats.fail),
              reputation: rep,
              reviews: reviewStats.get(r.offer.agentId) || null,
            }
          : null,
      };
    }),
  };
  await cache.set(cacheKey, payload, 10);
  return json(payload);
}
