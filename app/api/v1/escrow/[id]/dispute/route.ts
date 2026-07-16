import { NextRequest } from "next/server";
import { db, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { z } from "zod";
import { ALLOW_DEV_FAKE_SETTLEMENT } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const Body = z.object({
  reason: z.string().min(3).max(2000),
});

/**
 * POST /api/v1/escrow/:id/dispute
 * Buyer opens dispute while locked — freezes release until resolve/refund.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const escrow = db.getEscrow(id);
  if (!escrow) return json({ ok: false, error: "Escrow not found" }, 404);
  if (escrow.status !== "locked") {
    return json({ ok: false, error: `Escrow status ${escrow.status}` }, 409);
  }

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "reason required" }, 400);
  }

  const order = db.getOrder(escrow.orderId);
  const agentOrRes = requireAgent(req);
  if (isResponse(agentOrRes)) {
    if (!ALLOW_DEV_FAKE_SETTLEMENT) return agentOrRes;
  } else {
    const isBuyer = order?.buyerAgentId === agentOrRes.id;
    const isSeller = agentOrRes.id === escrow.sellerAgentId;
    if (!isBuyer && !isSeller) {
      return json({ ok: false, error: "Only parties can dispute" }, 403);
    }
  }

  escrow.status = "disputed";
  escrow.disputeReason = parsed.data.reason;
  escrow.updatedAt = new Date().toISOString();
  db.putEscrow(escrow);

  if (order) {
    order.result = {
      ...(typeof order.result === "object" && order.result
        ? (order.result as object)
        : {}),
      escrowId: escrow.id,
      disputed: true,
      disputeReason: parsed.data.reason,
    };
    db.putOrder(order);
  }

  audit("escrow.disputed", {
    escrowId: id,
    orderId: escrow.orderId,
    reason: parsed.data.reason,
  });
  return json({ ok: true, escrow, order });
}
