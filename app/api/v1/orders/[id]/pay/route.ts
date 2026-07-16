import { NextRequest } from "next/server";
import { OrderPaySchema } from "@/lib/types";
import { db, audit, ensureSeedCatalog, utcDay } from "@/lib/store";
import { json, options } from "@/lib/http";
import { verifyPayment, fulfillInline } from "@/lib/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * POST /api/v1/orders/:id/pay
 * Body: { transactionId } or { devFakePay: true }
 * Verifies settlement → fulfills → returns result
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const order = db.getOrder(id);
  if (!order) return json({ ok: false, error: "Not found" }, 404);
  if (order.status === "completed") {
    return json({ ok: true, order, note: "Already completed" });
  }
  if (order.status !== "awaiting_payment" && order.status !== "failed") {
    return json({ ok: false, error: `Invalid status ${order.status}` }, 409);
  }

  const body = await req.json().catch(() => null);
  const parsed = OrderPaySchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "Invalid body" }, 400);
  }

  const quote = db.getQuote(order.quoteId);
  if (!quote) return json({ ok: false, error: "Quote missing" }, 500);

  const v = await verifyPayment({
    transactionId: parsed.data.transactionId,
    devFakePay: parsed.data.devFakePay,
    expectedPayTo: quote.payTo,
    expectedAmount: order.totalAmount,
    asset: order.priceAsset,
  });
  if (!v.ok) {
    order.status = "failed";
    order.error = v.error;
    db.putOrder(order);
    audit("order.pay_fail", { orderId: order.id, error: v.error });
    return json({ ok: false, error: v.error, mode: v.mode }, 400);
  }

  if (parsed.data.transactionId) {
    db.markTxUsed(parsed.data.transactionId);
    order.transactionId = parsed.data.transactionId;
  }

  order.status = "fulfilling";
  db.putOrder(order);
  const t0 = Date.now();

  const offer = db.getOffer(order.offerId);
  let result: unknown;
  try {
    if (offer?.fulfillmentType === "webhook" && offer.webhookUrl) {
      const wr = await fetch(offer.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          offerId: offer.id,
          input: quote.input,
        }),
        signal: AbortSignal.timeout((offer.maxSeconds || 30) * 1000),
      });
      result = await wr.json().catch(() => ({ status: wr.status }));
    } else {
      result = fulfillInline(offer?.capability || "unknown", quote.input);
    }
    const latencyMs = Date.now() - t0;
    order.status = "completed";
    order.result = result;
    order.completedAt = new Date().toISOString();
    order.latencyMs = latencyMs;
    db.putOrder(order);

    // seller stats
    const seller = db.getAgent(order.sellerAgentId);
    if (seller) {
      seller.stats.sales += 1;
      seller.stats.success += 1;
      seller.stats.totalLatencyMs += latencyMs;
      db.putAgent(seller);
    }
    // buyer spend + stats
    if (order.buyerAgentId) {
      const buyer = db.getAgent(order.buyerAgentId);
      if (buyer) {
        if (buyer.policy.spentDay !== utcDay()) {
          buyer.policy.spentDay = utcDay();
          buyer.policy.spentToday = 0;
        }
        buyer.policy.spentToday += order.totalAmount;
        buyer.stats.purchases += 1;
        buyer.stats.success += 1;
        db.putAgent(buyer);
      }
    }

    audit("order.completed", {
      orderId: order.id,
      mode: v.mode,
      latencyMs,
    });

    return json({
      ok: true,
      order,
      settlementMode: v.mode,
    });
  } catch (e) {
    order.status = "failed";
    order.error = e instanceof Error ? e.message : "fulfill failed";
    db.putOrder(order);
    const seller = db.getAgent(order.sellerAgentId);
    if (seller) {
      seller.stats.fail += 1;
      db.putAgent(seller);
    }
    audit("order.fulfill_fail", { orderId: order.id, error: order.error });
    return json({ ok: false, error: order.error, order }, 500);
  }
}
