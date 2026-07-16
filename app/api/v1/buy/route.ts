import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureSeedCatalog, db, newId, audit, utcDay } from "@/lib/store";
import { json, options, getApiKey } from "@/lib/http";
import { PLATFORM_FEE_BPS } from "@/lib/config";
import { evaluateBuyerPolicy, allAllowed } from "@/lib/policy";
import {
  verifyPayment,
  fulfillInline,
  createEscrowForOrder,
} from "@/lib/settlement";
import { notifyWebhook } from "@/lib/webhooks";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const Body = z.object({
  offerId: z.string().min(4),
  input: z.record(z.unknown()).optional(),
  /** Production: real Hedera tx id after transfer */
  transactionId: z.string().min(8).optional(),
  /** Dev only */
  devFakePay: z.boolean().optional(),
});

/**
 * POST /api/v1/buy — one-shot agent purchase
 * quote → order → pay → fulfill (or escrow lock)
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`buy:${clientKey(req)}`, 120, 60_000);
  if (!rl.ok) return json({ ok: false, error: "Rate limit" }, 429);

  ensureSeedCatalog();
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "Invalid body", details: parsed.error.flatten() }, 400);
  }

  const offer = db.getOffer(parsed.data.offerId);
  if (!offer?.active) return json({ ok: false, error: "Offer not found" }, 404);

  const key = getApiKey(req);
  const buyer = key ? db.getAgentByKey(key) : undefined;
  const seller = db.getAgent(offer.agentId);

  const platformFee = Math.round(offer.priceAmount * PLATFORM_FEE_BPS) / 10000;
  const totalAmount = Number((offer.priceAmount + platformFee).toFixed(8));

  const policyResults = evaluateBuyerPolicy(
    buyer,
    totalAmount,
    seller?.walletAccountId
  );
  if (!allAllowed(policyResults)) {
    return json({ ok: false, error: "POLICY_BLOCKED", policyResults }, 403);
  }

  const payTo = process.env.HEDERA_OPERATOR_ID?.trim() || "0.0.OPERATOR_CONFIGURE_ME";
  const quote = {
    id: newId("qte"),
    offerId: offer.id,
    agentId: offer.agentId,
    buyerAgentId: buyer?.id,
    buyerWallet: buyer?.walletAccountId,
    priceAmount: offer.priceAmount,
    platformFee,
    totalAmount,
    priceAsset: offer.priceAsset,
    payTo,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    input: parsed.data.input,
    createdAt: new Date().toISOString(),
  };
  db.putQuote(quote);

  const order: import("@/lib/types").OrderRecord = {
    id: newId("ord"),
    quoteId: quote.id,
    offerId: offer.id,
    sellerAgentId: offer.agentId,
    buyerAgentId: buyer?.id,
    buyerWallet: buyer?.walletAccountId,
    totalAmount,
    platformFee,
    priceAsset: offer.priceAsset,
    status: "awaiting_payment",
    createdAt: new Date().toISOString(),
  };
  db.putOrder(order);

  // If no payment proof yet — return 402 with instructions (agent can pay then retry with tx)
  if (!parsed.data.transactionId && !parsed.data.devFakePay) {
    return json(
      {
        ok: false,
        code: "PAYMENT_REQUIRED",
        orderId: order.id,
        quoteId: quote.id,
        payment: {
          amount: totalAmount,
          asset: offer.priceAsset,
          payTo,
          memo: `openmarket:${quote.id}:${order.id}`,
        },
        retry: {
          method: "POST",
          path: "/api/v1/buy",
          body: {
            offerId: offer.id,
            input: parsed.data.input,
            transactionId: "<after-pay>",
          },
          or: {
            path: `/api/v1/orders/${order.id}/pay`,
            body: { transactionId: "<after-pay>" },
          },
        },
        policyResults,
      },
      402
    );
  }

  const v = await verifyPayment({
    transactionId: parsed.data.transactionId,
    devFakePay: parsed.data.devFakePay,
    expectedPayTo: payTo,
    expectedAmount: totalAmount,
    asset: offer.priceAsset,
  });
  if (!v.ok) {
    order.status = "failed";
    order.error = v.error;
    db.putOrder(order);
    return json({ ok: false, error: v.error, mode: v.mode, orderId: order.id }, 400);
  }
  if (parsed.data.transactionId) {
    db.markTxUsed(parsed.data.transactionId);
    order.transactionId = parsed.data.transactionId;
  }

  if (offer.escrow) {
    const escrow = createEscrowForOrder({
      orderId: order.id,
      amount: totalAmount,
      asset: offer.priceAsset,
      buyerWallet: order.buyerWallet,
      sellerAgentId: order.sellerAgentId,
    });
    order.status = "paid";
    order.result = { escrowId: escrow.id, status: "locked" };
    db.putOrder(order);
    if (buyer) {
      if (buyer.policy.spentDay !== utcDay()) {
        buyer.policy.spentDay = utcDay();
        buyer.policy.spentToday = 0;
      }
      buyer.policy.spentToday += totalAmount;
      buyer.stats.purchases += 1;
      db.putAgent(buyer);
    }
    audit("buy.escrow", { orderId: order.id, escrowId: escrow.id });
    return json({ ok: true, order, escrow, settlementMode: v.mode });
  }

  const t0 = Date.now();
  let result: unknown;
  if (offer.fulfillmentType === "webhook" && offer.webhookUrl) {
    const wr = await fetch(offer.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: order.id, offerId: offer.id, input: quote.input }),
      signal: AbortSignal.timeout((offer.maxSeconds || 30) * 1000),
    });
    result = await wr.json().catch(() => ({ status: wr.status }));
  } else {
    result = fulfillInline(offer.capability, quote.input);
  }
  const latencyMs = Date.now() - t0;
  order.status = "completed";
  order.result = result;
  order.completedAt = new Date().toISOString();
  order.latencyMs = latencyMs;
  db.putOrder(order);

  if (seller) {
    seller.stats.sales += 1;
    seller.stats.success += 1;
    seller.stats.totalLatencyMs += latencyMs;
    db.putAgent(seller);
  }
  if (buyer) {
    if (buyer.policy.spentDay !== utcDay()) {
      buyer.policy.spentDay = utcDay();
      buyer.policy.spentToday = 0;
    }
    buyer.policy.spentToday += totalAmount;
    buyer.stats.purchases += 1;
    buyer.stats.success += 1;
    db.putAgent(buyer);
  }
  audit("buy.completed", { orderId: order.id, mode: v.mode });
  if (seller?.webhookUrl) {
    void notifyWebhook(seller.webhookUrl, "order.completed", {
      orderId: order.id,
      offerId: offer.id,
      result,
    });
  }
  return json({ ok: true, order, settlementMode: v.mode, policyResults });
}
