import { NextRequest } from "next/server";
import { OfferCreateSchema } from "@/lib/types";
import { db, newId, audit, ensureSeedCatalog } from "@/lib/store";
import {
  json,
  options,
  requireAgent,
  isResponse,
  readJsonBody,
  rateLimitResponse,
} from "@/lib/http";
import { assertAssetLive } from "@/lib/assets";
import { publicOffer } from "@/lib/public-dto";
import { parsePublicHttpUrl } from "@/lib/ssrf";
import { redisRateLimit, clientKey } from "@/lib/rate-limit";
import { cache } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/offers — active offers (optional ?agentId= filter; no secret fields) */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const agentId = req.nextUrl.searchParams.get("agentId")?.trim() || undefined;
  // Unfiltered list is cacheable; filtered views are cheap and agent-specific.
  if (!agentId) {
    const cached = await cache.get<unknown>("offers:list");
    if (cached) return json(cached);
  }
  let offers = db.listOffers().filter((o) => o.active);
  if (agentId) offers = offers.filter((o) => o.agentId === agentId);
  const payload = { ok: true, offers: offers.map(publicOffer) };
  if (!agentId) await cache.set("offers:list", payload, 10);
  return json(payload);
}

/** POST /api/v1/offers — seller creates listing (auth) */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const rl = await redisRateLimit(`offer:${clientKey(req)}`, 60, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;
  const bodyRes = await readJsonBody(req);
  if (!bodyRes.ok) return bodyRes.response;
  const parsed = OfferCreateSchema.safeParse(bodyRes.data);
  if (!parsed.success) {
    return json(
      { ok: false, error: "Invalid body", details: parsed.error.flatten() },
      400
    );
  }
  const d = parsed.data;
  const assetOk = assertAssetLive(d.priceAsset);
  if (!assetOk.ok) {
    return json({ ok: false, error: assetOk.error }, 400);
  }
  const webhookUrl = d.webhookUrl || agent.webhookUrl;
  if (webhookUrl) {
    const safe = parsePublicHttpUrl(webhookUrl);
    if (safe.ok === false) {
      return json({ ok: false, error: `Invalid webhookUrl: ${safe.error}` }, 400);
    }
  }
  const offer = {
    id: newId("off"),
    agentId: agent.id,
    capability: d.capability,
    title: d.title,
    description: d.description,
    priceAmount: d.priceAmount,
    priceAsset: d.priceAsset,
    fulfillmentType: d.fulfillmentType,
    webhookUrl,
    maxSeconds: d.maxSeconds,
    escrow: d.escrow,
    tags: d.tags || [],
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.putOffer(offer);
  audit("offer.create", { offerId: offer.id, agentId: agent.id });
  await cache.del("offers:list");
  await cache.delPattern("offers:search:*");
  return json({ ok: true, offer: publicOffer(offer) });
}
