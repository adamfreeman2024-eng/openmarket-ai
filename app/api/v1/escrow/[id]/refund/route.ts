import { NextRequest } from "next/server";
import { db, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse, getApiKey } from "@/lib/http";
import { z } from "zod";
import { ALLOW_DEV_FAKE_SETTLEMENT } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const Body = z.object({
  reason: z.string().min(2).max(2000).optional(),
});

/**
 * POST /api/v1/escrow/:id/refund
 * Buyer (or seller / dev) refunds locked escrow → order failed/refunded.
 * CRITICAL FIX: Add replay attack protection
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const escrow = db.getEscrow(id);
  if (!escrow) return json({ ok: false, error: "Escrow not found" }, 404);
  
  // CRITICAL FIX: Prevent replay attacks - only allow refund from locked/disputed status
  if (escrow.status !== "locked" && escrow.status !== "disputed") {
    return json({ 
      ok: false, 
      error: `Cannot refund - escrow already ${escrow.status}, preventing replay attack` 
    }, 409);
  }

  const body = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  const reason = parsed.success ? parsed.data.reason : undefined;

  const order = db.getOrder(escrow.orderId);
  const agentOrRes = requireAgent(req);
  const key = getApiKey(req);

  if (isResponse(agentOrRes)) {
    if (!ALLOW_DEV_FAKE_SETTLEMENT) return agentOrRes;
  } else {
    const isSeller = agentOrRes.id === escrow.sellerAgentId;
    const isBuyer = order?.buyerAgentId === agentOrRes.id;
    if (!isSeller && !isBuyer) {
      return json(
        { ok: false, error: "Only buyer or seller agent can refund" },
        403
      );
    }
  }

  escrow.status = "refunded";
  escrow.reason = reason || "refund";
  escrow.updatedAt = new Date().toISOString();
  db.putEscrow(escrow);

  if (order) {
    order.status = "failed";
    order.error = `escrow_refunded:${escrow.reason}`;
    order.result = {
      escrowId: escrow.id,
      refunded: true,
      reason: escrow.reason,
    };
    order.completedAt = new Date().toISOString();
    db.putOrder(order);
    if (order.buyerAgentId) {
      const buyer = db.getAgent(order.buyerAgentId);
      if (buyer) {
        buyer.stats.fail += 1;
        db.putAgent(buyer);
      }
    }
  }

  audit("escrow.refunded", {
    escrowId: id,
    orderId: escrow.orderId,
    reason: escrow.reason,
    byKey: Boolean(key),
  });
  return json({
    ok: true,
    escrow,
    order,
    note: "Off-chain escrow state refunded — on-chain transfer reverse is Phase 8",
  });
}
