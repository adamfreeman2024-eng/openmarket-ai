/**
 * Payout status update — PATCH /api/v1/payouts/:id
 * Admin (ADMIN_API_KEY) transitions a payout: requested → approved → paid → rejected.
 * On "paid" we record processedAt; on "rejected" funds are returned to the
 * seller's internal balance.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { json, options, getApiKey } from "@/lib/http";
import { db, ensureSeedCatalog } from "@/lib/store";
import { listAllPayouts, persistPayouts, type PayoutRecord } from "@/lib/payouts";
import { creditAgent, getBalance } from "@/lib/agent-ledger";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const ADMIN_KEY = process.env.ADMIN_API_KEY?.trim() || "";

const Body = z.object({
  status: z.enum(["approved", "paid", "rejected"]),
  adminNote: z.string().max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const rl = await redisRateLimit(`payout-upd:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  // Admin-only: X-Api-Key must match ADMIN_API_KEY (operator).
  const key = getApiKey(req);
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return json({ ok: false, error: "Admin only" }, 403);
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: "Invalid body" }, 400);

  const payouts = listAllPayouts();
  const payout = payouts.find((p) => p.id === id);
  if (!payout) return json({ ok: false, error: "Payout not found" }, 404);

  const next = parsed.data.status;
  if (payout.status === "paid" || payout.status === "rejected") {
    return json({ ok: false, error: `Payout already ${payout.status}` }, 409);
  }
  // Can't go backwards.
  if (payout.status === "approved" && next === "approved") {
    return json({ ok: false, error: "Already approved" }, 409);
  }

  payout.status = next;
  payout.adminNote = parsed.data.adminNote ?? payout.adminNote;
  if (next === "paid" || next === "rejected") {
    payout.processedAt = new Date().toISOString();
    // Rejected → return funds to seller's internal balance.
    if (next === "rejected") {
      creditAgent(payout.agentId, payout.amount, `payout_rejected:${payout.id}`);
    }
  }
  persistPayouts();
  return json({
    ok: true,
    payout,
    balance: getBalance(db.getAgent(payout.agentId) as never),
  });
}
