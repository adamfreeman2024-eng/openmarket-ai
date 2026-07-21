import { NextRequest } from "next/server";
import { db, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { reputationForApi } from "@/lib/reputation";
import { USDC_TOKEN_ID } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * GET /api/v1/me — agent self-service dashboard (auth required)
 *
 * Headers: X-Api-Key: omk_...
 * Returns: profile, offers, buy/sell orders, escrow, revenue, reputation, webhook status
 */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const allOffers = db.listOffers();
  const allOrders = db.listOrders();
  const allEscrows = db.listEscrows();

  const myOffers = allOffers.filter((o) => o.agentId === agent.id);
  const sellOrders = allOrders.filter((o) => o.sellerAgentId === agent.id);
  const buyOrders = allOrders.filter((o) => o.buyerAgentId === agent.id);
  const myEscrows = allEscrows.filter((e) => e.sellerAgentId === agent.id);

  const completedSales = sellOrders.filter((o) => o.status === "completed");
  const completedBuys = buyOrders.filter((o) => o.status === "completed");
  const failedSales = sellOrders.filter((o) => o.status === "failed");

  const revenueByAsset: Record<string, number> = {};
  for (const o of completedSales) {
    const asset = o.priceAsset || "HBAR";
    revenueByAsset[asset] = (revenueByAsset[asset] || 0) + (o.totalAmount || 0);
  }

  const spentByAsset: Record<string, number> = {};
  for (const o of completedBuys) {
    const asset = o.priceAsset || "HBAR";
    spentByAsset[asset] = (spentByAsset[asset] || 0) + (o.totalAmount || 0);
  }

  const avgLatencyMs =
    completedSales.length > 0
      ? Math.round(
          completedSales.reduce((s, o) => s + (o.latencyMs || 0), 0) /
            completedSales.length
        )
      : null;

  const webhookOffers = myOffers.filter(
    (o) => o.fulfillmentType === "webhook" && o.webhookUrl
  );

  const rep = reputationForApi(agent, allEscrows, sellOrders.length);

  const recentSell = sellOrders
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 20)
    .map((o) => ({
      id: o.id,
      status: o.status,
      totalAmount: o.totalAmount,
      priceAsset: o.priceAsset,
      offerId: o.offerId,
      buyerAgentId: o.buyerAgentId,
      createdAt: o.createdAt,
      completedAt: o.completedAt,
      latencyMs: o.latencyMs,
      capability:
        allOffers.find((of) => of.id === o.offerId)?.capability || "unknown",
    }));

  const recentBuy = buyOrders
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 20)
    .map((o) => ({
      id: o.id,
      status: o.status,
      totalAmount: o.totalAmount,
      priceAsset: o.priceAsset,
      offerId: o.offerId,
      sellerAgentId: o.sellerAgentId,
      createdAt: o.createdAt,
      completedAt: o.completedAt,
      latencyMs: o.latencyMs,
      capability:
        allOffers.find((of) => of.id === o.offerId)?.capability || "unknown",
    }));

  return json({
    ok: true,
    agent: {
      id: agent.id,
      name: agent.name,
      walletAccountId: agent.walletAccountId,
      capabilities: agent.capabilities,
      webhookUrl: agent.webhookUrl,
      policy: agent.policy,
      stats: agent.stats,
      createdAt: agent.createdAt,
    },
    reputation: rep,
    summary: {
      offers: myOffers.length,
      activeOffers: myOffers.filter((o) => o.active !== false).length,
      sellOrders: sellOrders.length,
      buyOrders: buyOrders.length,
      completedSales: completedSales.length,
      completedBuys: completedBuys.length,
      failedSales: failedSales.length,
      successRate:
        sellOrders.length > 0
          ? Math.round((completedSales.length / sellOrders.length) * 1000) / 10
          : null,
      avgLatencyMs,
      escrows: myEscrows.length,
      webhookOffers: webhookOffers.length,
    },
    revenue: {
      byAsset: revenueByAsset,
      spentByAsset,
      note: "Amounts in human units (HBAR or USDC)",
    },
    settlement: {
      usdcLive: Boolean(USDC_TOKEN_ID),
      usdcTokenId: USDC_TOKEN_ID || null,
    },
    offers: myOffers.map((o) => ({
      id: o.id,
      capability: o.capability,
      title: o.title,
      priceAmount: o.priceAmount,
      priceAsset: o.priceAsset,
      fulfillmentType: o.fulfillmentType,
      webhookUrl: o.webhookUrl,
      active: o.active !== false,
      createdAt: o.createdAt,
    })),
    recentSellOrders: recentSell,
    recentBuyOrders: recentBuy,
    escrows: myEscrows.slice(-20).reverse().map((e) => ({
      id: e.id,
      status: e.status,
      amount: e.amount,
      asset: e.asset,
      orderId: e.orderId,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    })),
    webhook: {
      agentLevelUrl: agent.webhookUrl || null,
      offerWebhooks: webhookOffers.map((o) => ({
        offerId: o.id,
        capability: o.capability,
        url: o.webhookUrl,
      })),
      docs: {
        event: "fulfillment_request",
        method: "POST",
        headers: [
          "X-OpenMarket-Event",
          "X-OpenMarket-Order-Id",
          "X-OpenMarket-Offer-Id",
        ],
        body: {
          orderId: "string",
          offerId: "string",
          capability: "string",
          input: {},
          timestamp: "ISO-8601",
        },
        response: "JSON result returned to buyer",
      },
    },
  });
}
