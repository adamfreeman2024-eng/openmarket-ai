import { NextRequest } from "next/server";
import { db, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options } from "@/lib/http";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const Body = z.object({
  action: z.enum(["release", "refund"]),
  proof: z.string().min(2).max(2000).optional(),
  reason: z.string().min(2).max(2000).optional(),
});

/**
 * POST /api/v1/escrow/:id/resolve
 * Operator resolves disputed escrow (requires OPERATOR_API_KEY).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const op = process.env.OPERATOR_API_KEY?.trim();
  if (!op) {
    return json(
      {
        ok: false,
        error: "OPERATOR_API_KEY not configured",
      },
      503
    );
  }
  const key = req.headers.get("x-operator-key") || "";
  if (key !== op) return json({ ok: false, error: "Unauthorized" }, 401);

  const { id } = await ctx.params;
  const escrow = db.getEscrow(id);
  if (!escrow) return json({ ok: false, error: "Escrow not found" }, 404);
  if (escrow.status !== "disputed" && escrow.status !== "locked") {
    return json({ ok: false, error: `Escrow status ${escrow.status}` }, 409);
  }

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "action required: release|refund" }, 400);
  }

  const order = db.getOrder(escrow.orderId);

  if (parsed.data.action === "release") {
    escrow.status = "released";
    escrow.proof = parsed.data.proof || "operator_resolve";
    escrow.updatedAt = new Date().toISOString();
    db.putEscrow(escrow);
    if (order) {
      order.status = "completed";
      order.result = {
        escrowId: escrow.id,
        released: true,
        proof: escrow.proof,
        resolvedBy: "operator",
      };
      order.completedAt = new Date().toISOString();
      db.putOrder(order);
      const seller = db.getAgent(escrow.sellerAgentId);
      if (seller) {
        seller.stats.sales += 1;
        seller.stats.success += 1;
        db.putAgent(seller);
      }
    }
    audit("escrow.operator_release", { escrowId: id });
    return json({ ok: true, escrow, order });
  }

  // refund
  escrow.status = "refunded";
  escrow.reason = parsed.data.reason || "operator_refund";
  escrow.updatedAt = new Date().toISOString();
  db.putEscrow(escrow);
  if (order) {
    order.status = "failed";
    order.error = `operator_refund:${escrow.reason}`;
    order.result = {
      escrowId: escrow.id,
      refunded: true,
      reason: escrow.reason,
      resolvedBy: "operator",
    };
    order.completedAt = new Date().toISOString();
    db.putOrder(order);
  }
  audit("escrow.operator_refund", { escrowId: id });
  return json({ ok: true, escrow, order });
}
