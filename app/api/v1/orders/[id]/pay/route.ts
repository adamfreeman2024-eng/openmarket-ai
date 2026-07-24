import { NextRequest } from "next/server";
import { OrderPaySchema } from "@/lib/types";
import { db, audit, ensureSeedCatalog, utcDay } from "@/lib/store";
import {
  json,
  options,
  readJsonBody,
  rateLimitResponse,
  getApiKey,
} from "@/lib/http";
import {
  verifyPayment,
  fulfillOffer,
  createEscrowForOrder,
} from "@/lib/settlement";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * POST /api/v1/orders/:id/pay
 * Body: { transactionId } or { devFakePay: true }
 * Verifies settlement → fulfills → returns result
 *
 * Security:
 * - Failed verify does NOT poison order status (stays awaiting_payment)
 * - claimTxUsed before fulfill (replay / race)
 * - transitionOrderStatus CAS to reduce double-fulfill
 * - If order has buyerAgentId, API key must match that buyer (when provided)
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const rl = rateLimit(`pay:${clientKey(req)}`, 60, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);
  const { id } = await ctx.params;
  const order = db.getOrder(id);
  if (!order) return json({ ok: false, error: "Not found" }, 404);
  if (order.status === "completed") {
    return json({ ok: true, order, note: "Already completed" });
  }
  if (order.status === "fulfilling" || order.status === "paid") {
    return json(
      { ok: false, error: `Order busy (${order.status}) — retry shortly` },
      409
    );
  }
  if (order.status !== "awaiting_payment" && order.status !== "failed") {
    return json({ ok: false, error: `Invalid status ${order.status}` }, 409);
  }

  // Optional binding: if order has a registered buyer, require their key when sent
  if (order.buyerAgentId) {
    const key = getApiKey(req);
    if (key) {
      const agent = db.getAgentByKey(key);
      if (!agent || agent.id !== order.buyerAgentId) {
        return json({ ok: false, error: "API key does not match order buyer" }, 403);
      }
    }
  }

  const bodyRes = await readJsonBody(req);
  if (!bodyRes.ok) return bodyRes.response;
  const parsed = OrderPaySchema.safeParse(bodyRes.data);
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
    // Do NOT mark order failed — bad txs must not DoS legitimate buyers
    audit("order.pay_fail", { orderId: order.id, error: v.error });
    return json({ ok: false, error: v.error, mode: v.mode }, 400);
  }

  if (parsed.data.transactionId) {
    const claimed = db.claimTxUsed(parsed.data.transactionId);
    if (!claimed) {
      return json(
        { ok: false, error: "TRANSACTION_ALREADY_USED", mode: "replay" },
        409
      );
    }
    order.transactionId = parsed.data.transactionId;
    db.putOrder(order);
  }

  const locked = db.transitionOrderStatus(
    order.id,
    ["awaiting_payment", "failed"],
    "fulfilling"
  );
  if (!locked) {
    return json(
      { ok: false, error: "Order already being processed", mode: "race" },
      409
    );
  }
  // reload after transition
  const live = db.getOrder(order.id)!;
  const t0 = Date.now();

  const offer = db.getOffer(live.offerId);
  try {
    if (offer?.escrow) {
      const escrow = createEscrowForOrder({
        orderId: live.id,
        amount: live.totalAmount,
        asset: live.priceAsset,
        buyerWallet: live.buyerWallet,
        sellerAgentId: live.sellerAgentId,
      });
      live.status = "paid";
      live.result = {
        escrowId: escrow.id,
        status: "locked",
        next: `POST /api/v1/escrow/${escrow.id}/release { \"proof\": \"...\" }`,
      };
      live.completedAt = undefined;
      db.putOrder(live);
      audit("escrow.locked", { orderId: live.id, escrowId: escrow.id });
      if (live.buyerAgentId) {
        const buyer = db.getAgent(live.buyerAgentId);
        if (buyer) {
          if (buyer.policy.spentDay !== utcDay()) {
            buyer.policy.spentDay = utcDay();
            buyer.policy.spentToday = 0;
          }
          buyer.policy.spentToday += live.totalAmount;
          buyer.stats.purchases += 1;
          db.putAgent(buyer);
        }
      }
      return json({
        ok: true,
        order: live,
        escrow,
        settlementMode: v.mode,
        note: "Payment accepted; escrow locked until release",
      });
    }

    const result = await fulfillOffer(
      offer || { capability: "unknown" },
      quote.input as Record<string, unknown> | undefined,
      { orderId: live.id, offerId: offer?.id }
    );
    const latencyMs = Date.now() - t0;
    live.status = "completed";
    live.result = result;
    live.completedAt = new Date().toISOString();
    live.latencyMs = latencyMs;
    db.putOrder(live);

    const seller = db.getAgent(live.sellerAgentId);
    if (seller) {
      seller.stats.sales += 1;
      seller.stats.success += 1;
      seller.stats.totalLatencyMs += latencyMs;
      db.putAgent(seller);
    }
    if (live.buyerAgentId) {
      const buyer = db.getAgent(live.buyerAgentId);
      if (buyer) {
        if (buyer.policy.spentDay !== utcDay()) {
          buyer.policy.spentDay = utcDay();
          buyer.policy.spentToday = 0;
        }
        buyer.policy.spentToday += live.totalAmount;
        buyer.stats.purchases += 1;
        buyer.stats.success += 1;
        db.putAgent(buyer);
      }
    }

    audit("order.completed", {
      orderId: live.id,
      mode: v.mode,
      latencyMs,
    });

    return json({
      ok: true,
      order: live,
      settlementMode: v.mode,
    });
  } catch (e) {
    live.status = "failed";
    live.error = e instanceof Error ? e.message : "fulfill failed";
    db.putOrder(live);
    const seller = db.getAgent(live.sellerAgentId);
    if (seller) {
      seller.stats.fail += 1;
      db.putAgent(seller);
    }
    audit("order.fulfill_fail", { orderId: live.id, error: live.error });
    return json({ ok: false, error: live.error, order: live }, 500);
  }
}
