import { NextRequest } from "next/server";
import { z } from "zod";
import { db, newId, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { getBalance, debitAgent, creditAgent } from "@/lib/agent-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const HireSchema = z.object({
  /** Target agent id (seller) to hire */
  agentId: z.string().min(4),
  /** Capability being hired for (informational) */
  capability: z.string().min(1).max(64),
  /** Amount in internal balance units (price-asset) to pay */
  amount: z.number().positive(),
  /** Optional note */
  note: z.string().max(500).optional(),
});

/**
 * POST /api/v1/hire
 * Pay another agent from your platform internal balance (A2A credits).
 * Debits the caller's internalBalance, credits the target agent.
 */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const buyer = requireAgent(req);
  if (isResponse(buyer)) return buyer;

  const body = await req.json().catch(() => null);
  const parsed = HireSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { ok: false, error: "Invalid body", details: parsed.error.flatten() },
      400
    );
  }

  const seller = db.getAgent(parsed.data.agentId);
  if (!seller) {
    return json({ ok: false, error: "Target agent not found" }, 404);
  }
  if (seller.id === buyer.id) {
    return json({ ok: false, error: "Cannot hire yourself" }, 400);
  }

  const balance = getBalance(buyer);
  if (balance < parsed.data.amount) {
    return json(
      {
        ok: false,
        error: "INSUFFICIENT_BALANCE",
        balance,
        required: parsed.data.amount,
        hint: "Earn credits by completing sales, then retry.",
      },
      402
    );
  }

  const debit = debitAgent(
    buyer.id,
    parsed.data.amount,
    `hire:${seller.id}`
  );
  if (!debit.ok) {
    return json({ ok: false, error: debit.error }, 402);
  }

  creditAgent(seller.id, parsed.data.amount, `hired:${buyer.id}`);

  const order = {
    id: newId("ord"),
    quoteId: `internal:${parsed.data.capability}`,
    offerId: `internal:${seller.id}`,
    sellerAgentId: seller.id,
    buyerAgentId: buyer.id,
    buyerWallet: buyer.walletAccountId,
    totalAmount: parsed.data.amount,
    platformFee: 0,
    priceAsset: "HBAR" as const,
    status: "completed" as const,
    result: {
      internalLedger: true,
      capability: parsed.data.capability,
      note: parsed.data.note || null,
    },
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  db.putOrder(order);

  // bump stats for both sides
  seller.stats.sales += 1;
  seller.stats.success += 1;
  db.putAgent(seller);
  buyer.stats.purchases += 1;
  buyer.stats.success += 1;
  db.putAgent(buyer);

  audit("hire.internal", {
    buyerAgentId: buyer.id,
    sellerAgentId: seller.id,
    amount: parsed.data.amount,
    capability: parsed.data.capability,
    orderId: order.id,
  });

  return json({
    ok: true,
    orderId: order.id,
    paid: parsed.data.amount,
    balance: getBalance(buyer),
    message: `Hired ${seller.name} for ${parsed.data.amount} credits from internal balance.`,
  });
}
