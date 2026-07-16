import { NextRequest } from "next/server";
import { OrderCreateSchema } from "@/lib/types";
import { db, newId, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options, getApiKey } from "@/lib/http";
import { SITE_URL } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * GET /api/v1/orders
 * With X-Api-Key: only that agent's buys/sells.
 * Without: last 50 (demo) — set ORDERS_PUBLIC=false to require auth.
 */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const key = getApiKey(req);
  const agent = key ? db.getAgentByKey(key) : undefined;
  let orders = db.listOrders().slice().reverse();

  if (agent) {
    orders = orders.filter(
      (o) => o.buyerAgentId === agent.id || o.sellerAgentId === agent.id
    );
  } else if (process.env.ORDERS_PUBLIC === "false") {
    return json({ ok: false, error: "X-Api-Key required" }, 401);
  }

  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") || 50),
    200
  );
  return json({
    ok: true,
    count: orders.length,
    orders: orders.slice(0, limit),
    scoped: Boolean(agent),
  });
}

/** POST /api/v1/orders — create order → 402 Payment Required */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const body = await req.json().catch(() => null);
  const parsed = OrderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { ok: false, error: "Invalid body", details: parsed.error.flatten() },
      400
    );
  }
  const quote = db.getQuote(parsed.data.quoteId);
  if (!quote) return json({ ok: false, error: "Quote not found" }, 404);
  if (new Date(quote.expiresAt).getTime() < Date.now()) {
    return json({ ok: false, error: "Quote expired" }, 410);
  }

  const key = getApiKey(req);
  const buyer = key ? db.getAgentByKey(key) : undefined;

  const order = {
    id: newId("ord"),
    quoteId: quote.id,
    offerId: quote.offerId,
    sellerAgentId: quote.agentId,
    buyerAgentId: buyer?.id || quote.buyerAgentId,
    buyerWallet: buyer?.walletAccountId || quote.buyerWallet,
    totalAmount: quote.totalAmount,
    platformFee: quote.platformFee,
    priceAsset: quote.priceAsset,
    status: "awaiting_payment" as const,
    createdAt: new Date().toISOString(),
  };
  db.putOrder(order);
  audit("order.create", { orderId: order.id, quoteId: quote.id });

  return json(
    {
      ok: false,
      code: "PAYMENT_REQUIRED",
      orderId: order.id,
      payment: {
        amount: quote.totalAmount,
        asset: quote.priceAsset,
        payTo: quote.payTo,
        memo: `openmarket:${quote.id}:${order.id}`,
      },
      next: {
        pay: `${SITE_URL}/api/v1/orders/${order.id}/pay`,
        body: { transactionId: "<hedera-tx-id>" },
      },
    },
    402
  );
}
