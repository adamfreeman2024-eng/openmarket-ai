import { NextRequest } from "next/server";
import { QuoteRequestSchema } from "@/lib/types";
import { db, newId, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options, getApiKey, readJsonBody, rateLimitResponse } from "@/lib/http";
import { PLATFORM_FEE_BPS, SITE_URL, USDC_TOKEN_ID } from "@/lib/config";
import { evaluateBuyerPolicy, allAllowed } from "@/lib/policy";
import { assertAssetLive } from "@/lib/assets";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

function operatorPayTo() {
  return process.env.HEDERA_OPERATOR_ID?.trim() || "0.0.OPERATOR_CONFIGURE_ME";
}

/** POST /api/v1/quotes — lock price + fee for x402 */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const rl = rateLimit(`quote:${clientKey(req)}`, 120, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);
  const bodyRes = await readJsonBody(req);
  if (!bodyRes.ok) return bodyRes.response;
  const parsed = QuoteRequestSchema.safeParse(bodyRes.data);
  if (!parsed.success) {
    return json(
      { ok: false, error: "Invalid body", details: parsed.error.flatten() },
      400
    );
  }
  const offer = db.getOffer(parsed.data.offerId);
  if (!offer || !offer.active) {
    return json({ ok: false, error: "Offer not found" }, 404);
  }
  const assetOk = assertAssetLive(offer.priceAsset);
  if (!assetOk.ok) {
    return json({ ok: false, error: assetOk.error }, 400);
  }
  const seller = db.getAgent(offer.agentId);
  const key = getApiKey(req);
  const buyer = key ? db.getAgentByKey(key) : undefined;

  const platformFee =
    Math.round(offer.priceAmount * PLATFORM_FEE_BPS) / 10000;
  const totalAmount = Number((offer.priceAmount + platformFee).toFixed(8));

  const policyResults = evaluateBuyerPolicy(
    buyer,
    totalAmount,
    seller?.walletAccountId
  );
  if (!allAllowed(policyResults)) {
    return json(
      {
        ok: false,
        error: "POLICY_BLOCKED",
        policyResults,
      },
      403
    );
  }

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const quote = {
    id: newId("qte"),
    offerId: offer.id,
    agentId: offer.agentId,
    buyerAgentId: parsed.data.buyerAgentId || buyer?.id,
    buyerWallet: parsed.data.buyerWallet || buyer?.walletAccountId,
    priceAmount: offer.priceAmount,
    platformFee,
    totalAmount,
    priceAsset: offer.priceAsset,
    payTo: operatorPayTo(),
    expiresAt,
    input: parsed.data.input,
    createdAt: new Date().toISOString(),
  };
  db.putQuote(quote);
  audit("quote.create", { quoteId: quote.id, totalAmount });

  return json({
    ok: true,
    quote,
    x402: {
      scheme: "exact",
      network: "hedera-testnet",
      asset: quote.priceAsset,
      amount: quote.totalAmount,
      payTo: quote.payTo,
      tokenId:
        quote.priceAsset === "USDC" ? USDC_TOKEN_ID || null : null,
      memo: `openmarket:${quote.id}`,
      expiresAt: quote.expiresAt,
      next: {
        createOrder: `${SITE_URL}/api/v1/orders`,
        body: { quoteId: quote.id },
        orBuy: `${SITE_URL}/api/v1/buy`,
      },
    },
    policyResults,
  });
}
