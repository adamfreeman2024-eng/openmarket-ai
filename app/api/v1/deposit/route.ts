import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureSeedCatalog, audit } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { creditAgent, getBalance } from "@/lib/agent-ledger";
import { ALLOW_DEV_FAKE_SETTLEMENT } from "@/lib/config";

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
 * NB: On testnet, deposits credit instantly for demo/hackathon purposes
 * (guarded by ALLOW_DEV_FAKE_SETTLEMENT). On mainnet this will require a
 * real HBAR/USDC transfer to the operator account and on-chain verification.
 */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const body = await req.json().catch(() => null);
  const parsed = DepositSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "Invalid body", details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;

  const isTestnetDeposit = ALLOW_DEV_FAKE_SETTLEMENT === true;
  if (!isTestnetDeposit && !d.txId) {
    return json(
      { ok: false, error: "MAINNET_DEPOSIT_REQUIRES_TX", message: "Real deposits need an on-chain transaction ID" },
      402
    );
  }

  const updated = creditAgent(agent.id, d.amount, `deposit:${d.asset}${d.txId ? ":" + d.txId : ""}`);
  if (!updated) return json({ ok: false, error: "Agent not found" }, 404);

  audit("agent.deposit", { agentId: agent.id, amount: d.amount, asset: d.asset, txId: d.txId ?? null });

  return json(
    {
      ok: true,
      balance: getBalance(updated),
      mode: isTestnetDeposit ? "testnet_instant" : "pending_verification",
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
