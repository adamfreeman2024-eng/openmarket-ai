/**
 * GET /api/v1/admin/ledger — Task 5.2 Financial audit trail.
 * Operator's complete money view: where every USDC/HBAR is, per agent,
 * with the ledger audit trail (credits/debits), payout status, and totals.
 *
 * Auth: X-Api-Key === ADMIN_API_KEY (operator only).
 * Query: ?limit=200 (audit trail length, default 200, max 500)
 */
import { NextRequest } from "next/server";
import { json, options, getApiKey } from "@/lib/http";
import { db, ensureSeedCatalog } from "@/lib/store";
import { listAllPayouts } from "@/lib/payouts";
import { getBalance } from "@/lib/agent-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const ADMIN_KEY = process.env.ADMIN_API_KEY?.trim() || "";

export async function GET(req: NextRequest) {
  const key = getApiKey(req);
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return json({ ok: false, error: "Admin only" }, 403);
  }

  ensureSeedCatalog();

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") || 200);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(500, Math.floor(rawLimit)))
    : 200;

  const agents = db.listAgents();
  const orders = db.listOrders();
  const payouts = listAllPayouts();

  // Per-agent balance + completed-sale volume (where the money is).
  const agentBalances = agents
    .map((a) => ({
      agentId: a.id,
      name: a.name || null,
      internalBalance: getBalance(a),
      completedSales: orders.filter(
        (o) => o.sellerAgentId === a.id && o.status === "completed"
      ).length,
    }))
    .sort((x, y) => y.internalBalance - x.internalBalance);

  const ledgerEntries = (db.listAudit ? db.listAudit(500) : [])
    .filter((e) => e.type.startsWith("ledger."))
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      type: e.type,
      at: e.at,
      ...(e.payload as Record<string, unknown>),
    }));

  const pendingPayouts = payouts.filter(
    (p) => p.status === "requested" || p.status === "approved"
  );
  const paidPayouts = payouts.filter((p) => p.status === "paid");
  const rejectedPayouts = payouts.filter((p) => p.status === "rejected");

  const totalInternalBalance = agentBalances.reduce(
    (s, a) => s + a.internalBalance,
    0
  );
  const pendingPayoutAmount = pendingPayouts.reduce((s, p) => s + p.amount, 0);

  return json({
    ok: true,
    summary: {
      agents: agents.length,
      totalInternalBalance: Number(totalInternalBalance.toFixed(8)),
      // Money owed to sellers vs money sitting in agent balances.
      pendingPayoutAmount: Number(pendingPayoutAmount.toFixed(8)),
      pendingPayouts: pendingPayouts.length,
      paidOutTotal: Number(
        paidPayouts.reduce((s, p) => s + p.amount, 0).toFixed(8)
      ),
      paidOutCount: paidPayouts.length,
      rejectedPayouts: rejectedPayouts.length,
      ledgerEntries: ledgerEntries.length,
    },
    agentBalances,
    ledgerEntries,
    payouts: payouts
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100)
      .map((p) => ({
        id: p.id,
        agentId: p.agentId,
        amount: p.amount,
        method: p.method,
        status: p.status,
        orderId: p.orderId || undefined,
        createdAt: p.createdAt,
        processedAt: p.processedAt || undefined,
      })),
  });
}
