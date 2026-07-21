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
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/offers — all active offers */
export async function GET() {
  ensureSeedCatalog();
  return json({ ok: true, offers: db.listOffers() });
}

/** POST /api/v1/offers — seller creates listing (auth) */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const rl = rateLimit(`offer:${clientKey(req)}`, 60, 60_000);
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
  const offer = {
    id: newId("off"),
    agentId: agent.id,
    capability: d.capability,
    title: d.title,
    description: d.description,
    priceAmount: d.priceAmount,
    priceAsset: d.priceAsset,
    fulfillmentType: d.fulfillmentType,
    webhookUrl: d.webhookUrl || agent.webhookUrl,
    maxSeconds: d.maxSeconds,
    escrow: d.escrow,
    tags: d.tags || [],
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.putOffer(offer);
  audit("offer.create", { offerId: offer.id, agentId: agent.id });
  return json({ ok: true, offer });
}
