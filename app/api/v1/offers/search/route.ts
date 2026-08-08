import { NextRequest } from "next/server";
import { db, ensureSeedCatalog } from "@/lib/store";
import { searchOffers, type SLASignal } from "@/lib/ranking";
import { json, options } from "@/lib/http";
import { reputationForApi } from "@/lib/reputation";
import { getReviewStats, computeSLA } from "@/lib/reputation-v2";
import { publicOffer } from "@/lib/public-dto";
import { cache, searchCacheKey } from "@/lib/cache";
import { getCachedWebhookHealth } from "@/lib/webhook-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/offers/search?q=&capability=&maxPrice=&asset=&limit=&tags=&category=&sortBy=&minRating=&minReviewRating=&minOnTimeRate=&escrowOnly=&hideDegraded= */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const sp = req.nextUrl.searchParams;

  const cacheKey = searchCacheKey("offers:search", sp);
  const cached = await cache.get<unknown>(cacheKey);
  if (cached) return json(cached);

  const agents = new Map(db.listAgents().map((a) => [a.id, a]));
  const escrows = db.listEscrows();
  const orders = db.listOrders();

  const ordersByAgent = new Map<string, number>();
  for (const o of orders) {
    if (o.sellerAgentId) {
      ordersByAgent.set(
        o.sellerAgentId,
        (ordersByAgent.get(o.sellerAgentId) ?? 0) + 1
      );
    }
  }

  const slaStats = new Map<string, SLASignal>();
  const successRateByAgent = new Map<string, number>();
  for (const a of db.listAgents()) {
    const sellerOrders = orders.filter((o) => o.sellerAgentId === a.id);
    const sla = computeSLA(a, sellerOrders);
    if (sla.totalDeliveries > 0) {
      slaStats.set(a.id, {
        onTimeRate: sla.onTimeRate,
        totalDeliveries: sla.totalDeliveries,
        avgLatencyMs: sla.avgDeliveryTime,
      });
    }
    const success = a.stats.success;
    const fail = a.stats.fail;
    if (success + fail > 0) {
      successRateByAgent.set(a.id, success / (success + fail));
    }
  }

  const tagsParam = sp.get("tags");
  const tags = tagsParam
    ? tagsParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;

  const reviewStats = new Map<string, { average: number; total: number }>();
  for (const a of db.listAgents()) {
    const s = getReviewStats(a.id);
    if (s.total > 0) reviewStats.set(a.id, { average: s.average, total: s.total });
  }

  // Phase 7.1 — cached webhook health for ranking (no live probe on hot path)
  const webhookHealthByUrl = new Map<string, boolean>();
  const offers = db.listOffers();
  for (const o of offers) {
    if (!o.webhookUrl || webhookHealthByUrl.has(o.webhookUrl)) continue;
    const h = await getCachedWebhookHealth(o.webhookUrl);
    if (h) webhookHealthByUrl.set(o.webhookUrl, h.ok);
  }

  const hideDegraded =
    sp.get("hideDegraded") === "1" || sp.get("hideDegraded") === "true";

  const results = searchOffers(offers, agents, {
    q: sp.get("q") || undefined,
    capability: sp.get("capability") || undefined,
    maxPrice: sp.get("maxPrice") ? Number(sp.get("maxPrice")) : undefined,
    asset: sp.get("asset") || undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : 20,
    escrows,
    ordersByAgent,
    tags,
    category: sp.get("category") || undefined,
    sortBy:
      (sp.get("sortBy") as
        | "relevance"
        | "price_low"
        | "price_high"
        | "reputation"
        | "speed"
        | "rating"
        | "quality") || undefined,
    minRating: sp.get("minRating") ? Number(sp.get("minRating")) : undefined,
    minReviewRating: sp.get("minReviewRating")
      ? Number(sp.get("minReviewRating"))
      : undefined,
    minOnTimeRate: sp.get("minOnTimeRate")
      ? Number(sp.get("minOnTimeRate"))
      : undefined,
    escrowOnly: sp.get("escrowOnly") === "1" || sp.get("escrowOnly") === "true",
    reviewStats,
    slaStats,
    successRateByAgent,
    webhookHealthByUrl,
    hideDegraded,
  });

  const payload = {
    ok: true,
    count: results.length,
    results: results.map((r) => {
      const orderCount = ordersByAgent.get(r.offer.agentId) ?? 0;
      const rep = r.seller
        ? reputationForApi(r.seller, escrows, orderCount)
        : null;
      const wh = r.offer.webhookUrl
        ? webhookHealthByUrl.get(r.offer.webhookUrl)
        : undefined;
      return {
        score: Number(r.score.toFixed(6)),
        offer: publicOffer(r.offer, {
          webhookHealthy: wh === undefined ? null : wh,
        }),
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
              sla: slaStats.get(r.offer.agentId) || null,
            }
          : null,
      };
    }),
  };
  await cache.set(cacheKey, payload, 10);
  return json(payload);
}
