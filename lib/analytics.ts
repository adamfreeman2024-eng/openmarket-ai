/**
 * Analytics — platform-level and per-agent analytics.
 * 
 * Features:
 * - Transaction volume over time
 * - Top capabilities by revenue
 * - Agent performance metrics
 * - Geographic distribution (by wallet network)
 * - Escrow statistics
 * - Revenue breakdown (platform fees)
 */

import { db } from "./store";
import { log } from "./logger";
import { cache } from "./cache";

export type PlatformAnalytics = {
  totalAgents: number;
  totalOffers: number;
  totalOrders: number;
  completedOrders: number;
  failedOrders: number;
  totalVolume: { hbar: number; usdc: number };
  totalFees: { hbar: number; usdc: number };
  avgOrderValue: { hbar: number; usdc: number };
  avgLatencyMs: number;
  successRate: number;
  escrowStats: {
    total: number;
    locked: number;
    released: number;
    refunded: number;
    disputed: number;
  };
  topCapabilities: { capability: string; count: number; volume: number }[];
  topAgents: { agentId: string; name: string; orders: number; volume: number; successRate: number }[];
  ordersByDay: { date: string; count: number; volume: number }[];
  recentActivity: { type: string; description: string; timestamp: string }[];
};

export async function getPlatformAnalytics(): Promise<PlatformAnalytics> {
  // Check cache first (30s TTL)
  const cached = await cache.get<PlatformAnalytics>("analytics:platform");
  if (cached) return cached;

  const agents = db.listAgents();
  const offers = db.listOffers();
  const orders = db.listOrders();
  const escrows = db.listEscrows();

  const completedOrders = orders.filter((o) => o.status === "completed");
  const failedOrders = orders.filter((o) => o.status === "failed");
  const successCount = completedOrders.length;
  const failCount = failedOrders.length;
  const totalOrders = orders.length;
  const successRate = totalOrders > 0 ? successCount / totalOrders : 0;

  // Volume calculation
  let hbarVolume = 0;
  let usdcVolume = 0;
  let hbarFees = 0;
  let usdcFees = 0;
  let totalLatency = 0;
  let latencyCount = 0;

  for (const order of completedOrders) {
    const amount = order.totalAmount || 0;
    if (order.priceAsset === "USDC") {
      usdcVolume += amount;
      usdcFees += amount * 0.02; // 2% default
    } else {
      hbarVolume += amount;
      hbarFees += amount * 0.02;
    }
    if (order.latencyMs) {
      totalLatency += order.latencyMs;
      latencyCount++;
    }
  }

  const avgLatencyMs = latencyCount > 0 ? totalLatency / latencyCount : 0;

  // Top capabilities
  const capStats = new Map<string, { count: number; volume: number }>();
  const offerCache = new Map(offers.map((o) => [o.id, o]));
  for (const order of completedOrders) {
    const offer = offerCache.get(order.offerId);
    const cap = offer?.capability || "unknown";
    const cur = capStats.get(cap) || { count: 0, volume: 0 };
    cur.count++;
    cur.volume += order.totalAmount || 0;
    capStats.set(cap, cur);
  }
  const topCapabilities = Array.from(capStats.entries())
    .map(([capability, stats]) => ({ capability, ...stats }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10);

  // Top agents
  const agentStats = new Map<string, { orders: number; volume: number; success: number; fail: number }>();
  for (const order of orders) {
    if (!order.sellerAgentId) continue;
    const cur = agentStats.get(order.sellerAgentId) || { orders: 0, volume: 0, success: 0, fail: 0 };
    cur.orders++;
    cur.volume += order.totalAmount || 0;
    if (order.status === "completed") cur.success++;
    if (order.status === "failed") cur.fail++;
    agentStats.set(order.sellerAgentId, cur);
  }
  const topAgents = Array.from(agentStats.entries())
    .map(([agentId, stats]) => {
      const agent = db.getAgent(agentId);
      return {
        agentId,
        name: agent?.name || "Unknown",
        orders: stats.orders,
        volume: stats.volume,
        successRate: stats.success + stats.fail > 0 ? stats.success / (stats.success + stats.fail) : 0,
      };
    })
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10);

  // Orders by day (last 30 days)
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const ordersByDayMap = new Map<string, { count: number; volume: number }>();
  for (const order of orders) {
    if (!order.createdAt) continue;
    const created = new Date(order.createdAt).getTime();
    if (created < thirtyDaysAgo) continue;
    const dateStr = new Date(order.createdAt).toISOString().slice(0, 10);
    const cur = ordersByDayMap.get(dateStr) || { count: 0, volume: 0 };
    cur.count++;
    cur.volume += order.totalAmount || 0;
    ordersByDayMap.set(dateStr, cur);
  }
  const ordersByDay = Array.from(ordersByDayMap.entries())
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Escrow stats
  const escrowStats = {
    total: escrows.length,
    locked: escrows.filter((e) => e.status === "locked").length,
    released: escrows.filter((e) => e.status === "released").length,
    refunded: escrows.filter((e) => e.status === "refunded").length,
    disputed: escrows.filter((e) => e.status === "disputed").length,
  };

  // Recent activity
  const recentOrders = orders
    .filter((o) => o.createdAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);
  const recentActivity = recentOrders.map((o) => {
    const offer = offerCache.get(o.offerId);
    return {
      type: o.status === "completed" ? "order_completed" : "order_created",
      description: `${offer?.capability || "unknown"} — ${o.totalAmount || 0} ${o.priceAsset || "HBAR"}`,
      timestamp: o.createdAt,
    };
  });

  const analytics: PlatformAnalytics = {
    totalAgents: agents.length,
    totalOffers: offers.filter((o) => o.active).length,
    totalOrders: totalOrders,
    completedOrders: successCount,
    failedOrders: failCount,
    totalVolume: { hbar: hbarVolume, usdc: usdcVolume },
    totalFees: { hbar: hbarFees, usdc: usdcFees },
    avgOrderValue: {
      hbar: successCount > 0 ? hbarVolume / successCount : 0,
      usdc: successCount > 0 ? usdcVolume / successCount : 0,
    },
    avgLatencyMs,
    successRate,
    escrowStats,
    topCapabilities,
    topAgents,
    ordersByDay,
    recentActivity,
  };

  // Cache for 30 seconds
  await cache.set("analytics:platform", analytics, 30);

  return analytics;
}

export type AgentAnalytics = {
  agentId: string;
  name: string;
  totalOrders: number;
  completedOrders: number;
  failedOrders: number;
  totalVolume: number;
  avgOrderValue: number;
  avgLatencyMs: number;
  successRate: number;
  escrowStats: { total: number; released: number; refunded: number; disputed: number };
  capabilities: string[];
  offers: { id: string; capability: string; price: number; active: boolean }[];
  recentOrders: { id: string; status: string; amount: number; capability: string; createdAt: string }[];
};

export async function getAgentAnalytics(agentId: string): Promise<AgentAnalytics | null> {
  const agent = db.getAgent(agentId);
  if (!agent) return null;

  const allOrders = db.listOrders().filter((o) => o.sellerAgentId === agentId);
  const completed = allOrders.filter((o) => o.status === "completed");
  const failed = allOrders.filter((o) => o.status === "failed");
  const escrows = db.listEscrows().filter((e) => e.sellerAgentId === agentId);

  const totalVolume = completed.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const totalLatency = completed.reduce((sum, o) => sum + (o.latencyMs || 0), 0);

  const agentOffers = db.listOffers().filter((o) => o.agentId === agentId);
  const offerCache = new Map(agentOffers.map((o) => [o.id, o]));

  return {
    agentId,
    name: agent.name,
    totalOrders: allOrders.length,
    completedOrders: completed.length,
    failedOrders: failed.length,
    totalVolume,
    avgOrderValue: completed.length > 0 ? totalVolume / completed.length : 0,
    avgLatencyMs: completed.length > 0 ? totalLatency / completed.length : 0,
    successRate: allOrders.length > 0 ? completed.length / allOrders.length : 0,
    escrowStats: {
      total: escrows.length,
      released: escrows.filter((e) => e.status === "released").length,
      refunded: escrows.filter((e) => e.status === "refunded").length,
      disputed: escrows.filter((e) => e.status === "disputed").length,
    },
    capabilities: agent.capabilities,
    offers: agentOffers.map((o) => ({
      id: o.id,
      capability: o.capability,
      price: o.priceAmount,
      active: o.active,
    })),
    recentOrders: allOrders
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10)
      .map((o) => {
        const offer = offerCache.get(o.offerId);
        return {
          id: o.id,
          status: o.status,
          amount: o.totalAmount || 0,
          capability: offer?.capability || "unknown",
          createdAt: o.createdAt,
        };
      }),
  };
}
