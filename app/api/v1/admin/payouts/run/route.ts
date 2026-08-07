/**
 * POST /api/v1/admin/payouts/run — Task 6.3 auto-payout sweep.
 * Operator-triggered: for every seller whose internal balance is ≥ threshold
 * and who opted into auto-payout (payoutMethod), create a payout request and
 * debit the ledger. Idempotent (open payouts are skipped). Dry-run available.
 *
 * Auth: X-Api-Key must equal ADMIN_API_KEY (operator).
 * Body: { threshold?: number, dryRun?: boolean }
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { json, options, getApiKey } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import { schedulePayouts } from "@/lib/payouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const ADMIN_KEY = process.env.ADMIN_API_KEY?.trim() || "";

const Body = z.object({
  /** Min internal balance to auto-payout (default: AUTO_PAYOUT_THRESHOLD env or 50). */
  threshold: z.number().positive().optional(),
  /** Preview only — no records created, no ledger debited. */
  dryRun: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const rl = await redisRateLimit(`admin-payout-run:${clientKey(req)}`, 10, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const key = getApiKey(req);
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return json({ ok: false, error: "Admin only" }, 403);
  }

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "Invalid body", details: parsed.error.flatten() }, 400);
  }
  const { threshold, dryRun } = parsed.data;

  const result = schedulePayouts({ threshold, dryRun });

  return json({
    ok: true,
    dryRun: Boolean(dryRun),
    threshold: result.threshold,
    created: result.created.length,
    payouts: result.created,
    skippedNoOptIn: result.skippedNoOptIn.length,
    skippedOpenPayout: result.skippedOpenPayout.length,
    // For dry-run the operator may want to know WHO would be paid.
    ...(dryRun
      ? {
          wouldPay: result.created.map((p) => ({
            agentId: p.agentId,
            amount: p.amount,
            method: p.method,
            account: p.account,
          })),
        }
      : {}),
  });
}
