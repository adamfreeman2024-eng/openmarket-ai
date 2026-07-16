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

/** GET /api/v1/orders — list recent (demo) */
export async function GET() {
  ensureSeedCatalog();
  const orders = db.listOrders().slice(-50).reverse();
  return json({ ok: true, orders });
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
    buyerAgentId: parsed.data.buyerAgentId || quote.buyerAgentId || buyer?.id,
    buyerWallet:
      parsed.data.buyerWallet || quote.buyerWallet || buyer?.walletAccountId,
    totalAmount: quote.totalAmount,
    platformFee: quote.platformFee,
    priceAsset: quote.priceAsset,
    status: "awaiting_payment" as const,
    createdAt: new Date().toISOString(),
  };
  db.putOrder(order);
  audit("order.create", { orderId: order.id });

  // HTTP 402 Payment Required — x402-inspired
  return json(
    {
      ok: false,
      error: "Payment Required",
      code: "PAYMENT_REQUIRED",
      orderId: order.id,
      payment: {
        amount: order.totalAmount,
        asset: order.priceAsset,
        payTo: quote.payTo,
        memo: `openmarket:${quote.id}:${order.id}`,
        network: "hedera-testnet",
      },
      next: {
        method: "POST",
        url: `${SITE_URL}/api/v1/orders/${order.id}/pay`,
        body: {
          transactionId: "<hedera-tx-id-after-transfer>",
          devFakePay: true,
        },
        note: "devFakePay only when ALLOW_DEV_FAKE_SETTLEMENT=true",
      },
    },
    402
  );
}
