import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureSeedCatalog, db, newId, audit, utcDay } from "@/lib/store";
import { json, options, getApiKey } from "@/lib/http";
import {
  verifyPayment,
  fulfillOffer,
  createEscrowForOrder,
} from "@/lib/settlement";
import { buildOnChainDepositPlan, isEscrowContractLive } from "@/lib/onchain-escrow";
import { PLATFORM_FEE_BPS, ESCROW_CONTRACT_ADDRESS, escrowLockMs } from "@/lib/config";
import { evaluateBuyerPolicy, allAllowed } from "@/lib/policy";
import { notifyWebhook } from "@/lib/webhooks";
import { notify } from "@/lib/notifications";
import { redisRateLimit, clientKey } from "@/lib/rate-limit";
import { getBalance, debitAgent, creditSale } from "@/lib/agent-ledger";

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
  const rl = await redisRateLimit(`buy:${clientKey(req)}`, 120, 60_000);
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
    seller?.walletAccountId,
    (updatedAgent) => {
      // Persist updated policy (spentDay reset) to store
      db.putAgent(updatedAgent);
    }
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

  // Internal balance fast-path (Phase 2.1): a registered buyer with
  // sufficient internalBalance pays WITHOUT an on-chain transaction —
  // no Hedera wallet knowledge required. Escrow offers still need the
  // on-chain escrow flow (funds live in the contract).
  let internalPaid = false;
  if (
    !parsed.data.transactionId &&
    !parsed.data.devFakePay &&
    buyer &&
    !offer.escrow &&
    getBalance(buyer) >= totalAmount
  ) {
    const debited = debitAgent(buyer.id, totalAmount, `buy:${order.id}`);
    if (!debited.ok) {
      return json({ ok: false, error: debited.error }, 400);
    }
    internalPaid = true;
    order.transactionId = `internal:${order.id}`;
    order.status = "paid";
    db.putOrder(order);
    audit("buy.internal_balance", {
      orderId: order.id,
      amount: totalAmount,
      balance: getBalance(debited.agent),
    });
  }

  // If no payment proof yet — return 402 with instructions (agent can pay then retry with tx)
  if (!internalPaid && !parsed.data.transactionId && !parsed.data.devFakePay) {
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
        // SLA guarantee (Phase 6.2): escrow-backed orders auto-refund if the
        // seller doesn't deliver by the deadline — buyer sees this BEFORE paying.
        guarantee: offer.escrow
          ? {
              escrow: true,
              deadline: new Date(Date.now() + escrowLockMs()).toISOString(),
              message: `Your funds are protected by escrow until this deadline. If the seller does not deliver by then, the full amount is automatically refunded.`,
            }
          : undefined,
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

  // Skip on-chain verification when paid from internal balance.
  const v = internalPaid
    ? { ok: true as const, mode: "internal_balance", creditedBase: totalAmount }
    : await verifyPayment({
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
    const claimed = db.claimTxUsed(parsed.data.transactionId);
    if (!claimed) {
      return json(
        { ok: false, error: "TRANSACTION_ALREADY_USED", mode: "replay", orderId: order.id },
        409
      );
    }
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
    const onChain = buildOnChainDepositPlan({
      orderId: order.id,
      sellerEvmAddress: "0x0000000000000000000000000000000000000000",
      amountWei: "0",
    });
    if (isEscrowContractLive()) {
      escrow.onChainRef = onChain.ok ? String(onChain.args?.orderId) : ESCROW_CONTRACT_ADDRESS;
      db.putEscrow(escrow);
    }
    return json({
      ok: true,
      order,
      escrow,
      // SLA guarantee (Phase 6.2): funds auto-refund if seller doesn't
      // deliver by this deadline — buyer sees the guarantee at checkout.
      guarantee: {
        escrow: true,
        deadline: escrow.expiresAt,
        message: `Your funds are protected by escrow until ${escrow.expiresAt}. If the seller does not deliver by then, the full amount is automatically refunded.`,
      },
      settlementMode: v.mode,
      onChainEscrow: onChain,
      contractLive: isEscrowContractLive(),
    });
  }

  const t0 = Date.now();
  const result = await fulfillOffer(
    offer,
    quote.input as Record<string, unknown> | undefined,
    { orderId: order.id, offerId: offer.id }
  );
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
    // Platform internal ledger — credit seller for non-escrow completed order.
    const sellerAmount = Number(((order.totalAmount || 0) - (order.platformFee || 0)).toFixed(8));
    if (sellerAmount > 0) creditSale(seller.id, sellerAmount, order.id);
  }
  if (buyer) {
    // Reload fresh — internal-balance debit already mutated the stored agent.
    const buyerFresh = db.getAgent(buyer.id) || buyer;
    if (buyerFresh.policy.spentDay !== utcDay()) {
      buyerFresh.policy.spentDay = utcDay();
      buyerFresh.policy.spentToday = 0;
    }
    buyerFresh.policy.spentToday += totalAmount;
    buyerFresh.stats.purchases += 1;
    buyerFresh.stats.success += 1;
    db.putAgent(buyerFresh);
  }
  audit("buy.completed", { orderId: order.id, mode: v.mode });
  if (seller?.webhookUrl) {
    void notifyWebhook(seller.webhookUrl, "order.completed", {
      orderId: order.id,
      offerId: offer.id,
      result,
    });
  }
  // Multi-channel notifications (Telegram/email/webhook) for both sides
  if (seller) {
    void notify.agent(seller.id, "order_completed", {
      orderId: order.id,
      offerId: offer.id,
      result,
    });
  }
  if (buyer) {
    void notify.agent(buyer.id, "order_completed", {
      orderId: order.id,
      offerId: offer.id,
      buyer: true,
    });
  }
  return json({ ok: true, order, settlementMode: v.mode, policyResults });
}
