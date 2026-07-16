import { NextRequest } from "next/server";
import { db, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const Body = z.object({
  proof: z.string().min(2).max(2000),
});

/**
 * POST /api/v1/escrow/:id/release
 * Seller (or operator) provides delivery proof → release + complete order
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
    return json({ ok: false, error: "proof required" }, 400);
  }

  // Optional: seller api key must match escrow seller
  const agentOrRes = requireAgent(req);
  if (!isResponse(agentOrRes)) {
    if (agentOrRes.id !== escrow.sellerAgentId) {
      return json({ ok: false, error: "Only seller agent can release" }, 403);
    }
  }
  // If no auth, allow in dev for smoke (document this)
  // Production: require seller key

  escrow.status = "released";
  escrow.proof = parsed.data.proof;
  escrow.updatedAt = new Date().toISOString();
  db.putEscrow(escrow);

  const order = db.getOrder(escrow.orderId);
  if (order) {
    order.status = "completed";
    order.result = {
      escrowId: escrow.id,
      released: true,
      proof: escrow.proof,
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

  audit("escrow.released", { escrowId: id, orderId: escrow.orderId });
  return json({ ok: true, escrow, order });
}
