import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureSeedCatalog, db, audit } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import { creditAgent, getBalance } from "@/lib/agent-ledger";
import { ALLOW_DEV_FAKE_SETTLEMENT } from "@/lib/config";
import { verifyPayment } from "@/lib/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const DepositSchema = z.object({
  amount: z.number().positive(),
  asset: z.enum(["hbar", "usdc", "internal"]).default("internal"),
  txId: z.string().optional(),
});

/**
 * Deposit — top up your internal ledger balance.
 * POST /api/v1/deposit { amount, asset?, txId? }
 *
 * Security: on-chain deposits (ALLOW_DEV_FAKE_SETTLEMENT=false) VERIFY the
 * transaction on the mirror node — the tx must be SUCCESS and credit the
 * operator treasury (HEDERA_OPERATOR_ID) with >= amount. A random txId does
 * not credit anything (previously it did — a real funding gap).
 * Replay protection via claimTxUsed.
 */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const rl = await redisRateLimit(`deposit:${clientKey(req)}`, 30, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const body = await req.json().catch(() => null);
  const parsed = DepositSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "Invalid body", details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;

  const isTestnetDeposit = ALLOW_DEV_FAKE_SETTLEMENT === true;
  if (!isTestnetDeposit) {
    if (!d.txId) {
      return json(
        { ok: false, error: "MAINNET_DEPOSIT_REQUIRES_TX", message: "Real deposits need an on-chain transaction ID" },
        402
      );
    }
    // On-chain verification: tx must credit the operator treasury with >= amount.
    const payTo = process.env.HEDERA_OPERATOR_ID?.trim() || "0.0.OPERATOR_CONFIGURE_ME";
    const v = await verifyPayment({
      transactionId: d.txId,
      expectedPayTo: payTo,
      expectedAmount: d.amount,
      asset: d.asset === "usdc" ? "USDC" : "HBAR",
    });
    if (!v.ok) {
      return json({ ok: false, error: v.error, mode: v.mode, details: v.details }, 400);
    }
    const claimed = db.claimTxUsed(d.txId);
    if (!claimed) {
      return json({ ok: false, error: "TRANSACTION_ALREADY_USED", mode: "replay" }, 409);
    }
  }

  const updated = creditAgent(agent.id, d.amount, `deposit:${d.asset}${d.txId ? ":" + d.txId : ""}`);
  if (!updated) return json({ ok: false, error: "Agent not found" }, 404);

  audit("agent.deposit", { agentId: agent.id, amount: d.amount, asset: d.asset, txId: d.txId ?? null });

  return json(
    {
      ok: true,
      balance: getBalance(updated),
      mode: isTestnetDeposit ? "testnet_instant" : "mirror_verified",
    },
    201
  );
}

/** GET /api/v1/deposit — returns current balance + deposit mode */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;
  return json({
    ok: true,
    balance: getBalance(agent),
    mode: ALLOW_DEV_FAKE_SETTLEMENT === true ? "testnet_instant" : "mainnet_requires_tx",
  });
}
