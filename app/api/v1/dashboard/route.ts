import { NextRequest } from "next/server";
import { db, ensureSeedCatalog } from "@/lib/store";
import { json, options } from "@/lib/http";
import { reputationForApi } from "@/lib/reputation";
import { isEscrowContractLive } from "@/lib/onchain-escrow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/dashboard — full marketplace overview for UI dashboard */
export async function GET() {
  ensureSeedCatalog();

  const agents = db.listAgents();
  const offers = db.listOffers();
  const orders = db.listOrders();
  const escrows = db.listEscrows();
  const audit = db.listAudit(20);

  const escrowsByStatus = {
    locked: escrows.filter((e) => e.status === "locked").length,
    released: escrows.filter((e) => e.status === "released").length,
    refunded: escrows.filter((e) => e.status === "refunded").length,
    disputed: escrows.filter((e) => e.status === "disputed").length,
  };

  const ordersByStatus = {
    completed: orders.filter((o) => o.status === "completed").length,
    failed: orders.filter((o) => o.status === "failed").length,
    awaiting_payment: orders.filter((o) => o.status === "awaiting_payment").length,
    paid: orders.filter((o) => o.status === "paid").length,
  };

  // Top agents by reputation
  const agentReps = agents.map((a) => {
    const orderCount = orders.filter((o) => o.sellerAgentId === a.id).length;
    const rep = reputationForApi(a, escrows, orderCount);
    return {
      id: a.id,
      name: a.name,
      walletAccountId: a.walletAccountId,
      capabilities: a.capabilities,
      createdAt: a.createdAt,
      stats: a.stats,
      reputation: rep,
    };
  }).sort((a, b) => b.reputation.score - a.reputation.score);

  // Capability distribution
  const capCounts: Record<string, number> = {};
  for (const o of offers) {
    capCounts[o.capability] = (capCounts[o.capability] || 0) + 1;
  }

  // Recent orders
  const recentOrders = orders.slice(-10).reverse().map((o) => ({
    id: o.id,
    status: o.status,
    totalAmount: o.totalAmount,
    priceAsset: o.priceAsset,
    capability: offers.find((of) => of.id === o.offerId)?.capability || "unknown",
    sellerAgentId: o.sellerAgentId,
    buyerAgentId: o.buyerAgentId,
    createdAt: o.createdAt,
    completedAt: o.completedAt,
    latencyMs: o.latencyMs,
  }));

  return json({
    ok: true,
    summary: {
      totalAgents: agents.length,
      totalOffers: offers.length,
      totalOrders: orders.length,
      totalEscrows: escrows.length,
      contractLive: isEscrowContractLive(),
    },
    ordersByStatus,
    escrowsByStatus,
    capabilities: capCounts,
    topAgents: agentReps.slice(0, 10),
    recentOrders,
    recentAudit: audit,
  });
}
