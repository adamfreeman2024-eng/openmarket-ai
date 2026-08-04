import { NextRequest } from "next/server";
import { z } from "zod";
import { db, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import { getBalance, debitAgent } from "@/lib/agent-ledger";
import { addPayout, listPayoutsByAgent } from "@/lib/payouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const PayoutSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["hbar", "usdc", "manual"]).default("manual"),
  account: z.string().min(1).max(256).optional(),
});

/**
 * Payouts — sellers withdraw earned internal balance.
 * POST /api/v1/payouts { amount, method?, account? }
 * GET  /api/v1/payouts — own payout requests
 *
 * NB: On testnet, withdrawals are REQUEST-only (operator settles manually).
 * A real on-chain payout path requires mainnet operator keys.
 */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const rl = await redisRateLimit(`payout:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const body = await req.json().catch(() => null);
  const parsed = PayoutSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "Invalid body", details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;

  const balance = getBalance(agent);
  if (balance < d.amount) {
    return json({ ok: false, error: "INSUFFICIENT_BALANCE", balance }, 402);
  }

  const payout = addPayout({
    agentId: agent.id,
    amount: d.amount,
    method: d.method,
    account: d.account ?? null,
  });

  // Debit the internal ledger immediately (payout pending settlement)
  const debited = debitAgent(agent.id, d.amount, `payout:${payout.id}`);
  if (!debited.ok) {
    return json({ ok: false, error: debited.error }, 400);
  }

  return json(
    {
      ok: true,
      payout,
      balance: getBalance(debited.agent),
    },
    201
  );
}

export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const payouts = listPayoutsByAgent(agent.id);
  return json({
    ok: true,
    balance: getBalance(agent),
    payouts,
  });
}
