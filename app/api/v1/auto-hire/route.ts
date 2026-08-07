/**
 * Auto-Hire — one-call "find me the best agent for this job and do it."
 *
 * POST /api/v1/auto-hire { capability?, prompt?, input?, prefer?, maxPrice? }
 *
 * The buyer agent just says what it needs; the platform:
 *   1. Ranks offers by quality (reviews + SLA + success rate)
 *   2. Creates quote + order for the best match
 *   3. Pays from internal balance (no on-chain tx for non-escrow offers)
 *   4. Fulfills inline/LLM and returns the result
 *
 * This is the single biggest UX jump for agent buyers: one call, done.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db, newId, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import { getBalance, debitAgent, creditSale, creditAgent } from "@/lib/agent-ledger";
import { searchOffers } from "@/lib/ranking";
import { fulfillOffer } from "@/lib/settlement";
import { PLATFORM_FEE_BPS } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const AutoHireSchema = z.object({
  /** What you need — free text or an exact capability. At least one required. */
  capability: z.string().min(1).max(64).optional(),
  prompt: z.string().min(3).max(500).optional(),
  /** Payload forwarded to the agent. */
  input: z.record(z.unknown()).optional(),
  /** Ranking preference. */
  prefer: z.enum(["quality", "price_low", "speed"]).default("quality"),
  /** Max price cap (in asset units). */
  maxPrice: z.number().positive().optional(),
});

export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const buyer = requireAgent(req);
  if (isResponse(buyer)) return buyer;

  const rl = await redisRateLimit(`auto-hire:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const body = await req.json().catch(() => null);
  const parsed = AutoHireSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "Invalid body", details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  if (!d.capability && !d.prompt) {
    return json({ ok: false, error: "Need capability or prompt" }, 400);
  }

  // 1. Rank offers by quality (or the requested preference). Prefer non-escrow
  // so the whole flow can complete from internal balance; escrow-only matches
  // return instructions to use the standard escrow buy flow.
  const offers = db.listOffers();
  const agents = new Map(db.listAgents().map((a) => [a.id, a]));
  const sortBy = d.prefer === "price_low" ? "price_low" : d.prefer === "speed" ? "speed" : "quality";
  const nonEscrow = searchOffers(offers, agents, {
    q: d.prompt || undefined,
    capability: d.capability,
    maxPrice: d.maxPrice,
    escrowOnly: false,
    sortBy,
    limit: 3,
  }).filter((r) => !r.offer.escrow);
  const results = nonEscrow.length > 0 ? nonEscrow : searchOffers(offers, agents, {
    q: d.prompt || undefined,
    capability: d.capability,
    maxPrice: d.maxPrice,
    sortBy,
    limit: 1,
  });
  if (results.length === 0) {
    return json({ ok: false, error: "NO_MATCH", hint: "No offer found for that request" }, 404);
  }

  const offer = results[0].offer;
  const seller = agents.get(offer.agentId);
  if (!seller || seller.id === buyer.id) {
    return json({ ok: false, error: "NO_MATCH", hint: "Best match not sellable to you" }, 404);
  }
  if (offer.escrow) {
    return json(
      {
        ok: false,
        error: "ESCROW_REQUIRES_BUY_FLOW",
        hint: "The best match uses on-chain escrow. Use POST /api/v1/buy with offerId to complete the escrow flow.",
        offerId: offer.id,
      },
      402
    );
  }

  // 2. Quote + order (mirror of the buy flow).
  const platformFee = Math.round(offer.priceAmount * PLATFORM_FEE_BPS) / 10000;
  const totalAmount = Number((offer.priceAmount + platformFee).toFixed(8));
  const payTo = process.env.HEDERA_OPERATOR_ID?.trim() || "0.0.OPERATOR_CONFIGURE_ME";
  const quote: import("@/lib/types").QuoteRecord = {
    id: newId("qte"),
    offerId: offer.id,
    agentId: offer.agentId,
    buyerAgentId: buyer.id,
    buyerWallet: buyer.walletAccountId,
    priceAmount: offer.priceAmount,
    platformFee,
    totalAmount,
    priceAsset: offer.priceAsset,
    payTo,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    input: d.input,
    createdAt: new Date().toISOString(),
  };
  db.putQuote(quote);

  const order: import("@/lib/types").OrderRecord = {
    id: newId("ord"),
    quoteId: quote.id,
    offerId: offer.id,
    sellerAgentId: offer.agentId,
    buyerAgentId: buyer.id,
    buyerWallet: buyer.walletAccountId,
    totalAmount,
    platformFee,
    priceAsset: offer.priceAsset,
    status: "awaiting_payment",
    createdAt: new Date().toISOString(),
  };
  db.putOrder(order);

  // 3. Pay from internal balance.
  if (getBalance(buyer) < totalAmount) {
    return json(
      {
        ok: false,
        code: "INSUFFICIENT_BALANCE",
        orderId: order.id,
        quoteId: quote.id,
        balance: getBalance(buyer),
        required: totalAmount,
        hint: "Top up via POST /api/v1/deposit, then retry.",
      },
      402
    );
  }
  const debited = debitAgent(buyer.id, totalAmount, `auto-hire:${order.id}`);
  if (!debited.ok) return json({ ok: false, error: debited.error }, 400);
  order.transactionId = `internal:${order.id}`;
  order.status = "paid";
  db.putOrder(order);
  audit("auto_hire.internal_balance", { orderId: order.id, amount: totalAmount, offerId: offer.id });

  // 4. Fulfill (inline/LLM/webhook fallback — returns the result directly).
  const t0 = Date.now();
  let result: unknown;
  try {
    result = await fulfillOffer(
      offer,
      quote.input as Record<string, unknown> | undefined,
      { orderId: order.id, offerId: offer.id }
    );
  } catch (e) {
    order.status = "failed";
    order.result = { error: e instanceof Error ? e.message : String(e) };
    order.completedAt = new Date().toISOString();
    db.putOrder(order);
    creditAgent(buyer.id, totalAmount, `auto-hire-refund:${order.id}`);
    return json({ ok: false, error: "FULFILL_FAILED", orderId: order.id, details: order.result }, 500);
  }

  // 5. Complete + credit seller.
  const latencyMs = Date.now() - t0;
  order.status = "completed";
  order.result = result;
  order.completedAt = new Date().toISOString();
  order.latencyMs = latencyMs;
  order.sellerAmount = Number((totalAmount - platformFee).toFixed(8));
  db.putOrder(order);

  if (seller.stats) {
    seller.stats.sales += 1;
    seller.stats.success += 1;
    seller.stats.totalLatencyMs += latencyMs;
    db.putAgent(seller);
  }
  if (order.sellerAmount > 0) creditSale(seller.id, order.sellerAmount, order.id);

  audit("auto_hire.completed", {
    orderId: order.id, offerId: offer.id, sellerAgentId: seller.id, buyerAgentId: buyer.id,
    totalAmount, mode: "internal_balance",
  });

  return json({
    ok: true,
    orderId: order.id,
    offer: { id: offer.id, title: offer.title, capability: offer.capability },
    seller: { id: seller.id, name: seller.name },
    amount: { price: offer.priceAmount, fee: platformFee, total: totalAmount, asset: offer.priceAsset },
    result,
    balance: getBalance(db.getAgent(buyer.id) || buyer),
    latencyMs,
  });
}
