/**
 * Prometheus metrics endpoint — /api/v1/metrics
 * Format: standard Prometheus text exposition format
 * No external dependencies — lightweight counter/gauge impl
 */
import { db } from "@/lib/store";
import { STRICT_SETTLEMENT, usdcMeta } from "@/lib/settlement";
import {
  ALLOW_DEV_FAKE_SETTLEMENT,
  PLATFORM_FEE_BPS,
  NETWORK,
} from "@/lib/config";
import { isEscrowContractLive } from "@/lib/onchain-escrow";
import { llmMeta } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const dynamicParams = true;

// Simple in-memory counters (reset on restart)
const counters: Record<string, number> = {};
function inc(name: string, by = 1) {
  counters[name] = (counters[name] || 0) + by;
}

// Track since process start
const startedAt = Date.now();

/** GET /api/v1/metrics — Prometheus text format */
export async function GET() {
  const orders = db.listOrders();
  const agents = db.listAgents();
  const offers = db.listOffers();
  const escrows = db.listEscrows();
  const audit = db.listAudit(1);

  const completed = orders.filter((o) => o.status === "completed").length;
  const failed = orders.filter((o) => o.status === "failed").length;
  const lockedEscrows = escrows.filter((e) => e.status === "locked").length;
  const releasedEscrows = escrows.filter((e) => e.status === "released").length;
  const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);

  const lines: string[] = [];

  // --- Metrics ---
  lines.push("# HELP openmarket_orders_total Total orders by status");
  lines.push("# TYPE openmarket_orders_total gauge");
  lines.push(`openmarket_orders_total{status="completed"} ${completed}`);
  lines.push(`openmarket_orders_total{status="failed"} ${failed}`);
  lines.push(`openmarket_orders_total{status="awaiting_payment"} ${orders.filter(o => o.status === "awaiting_payment").length}`);
  lines.push(`openmarket_orders_total{status="paid"} ${orders.filter(o => o.status === "paid").length}`);

  lines.push("# HELP openmarket_agents_total Total registered agents");
  lines.push("# TYPE openmarket_agents_total gauge");
  lines.push(`openmarket_agents_total ${agents.length}`);

  lines.push("# HELP openmarket_offers_total Total active offers");
  lines.push("# TYPE openmarket_offers_total gauge");
  lines.push(`openmarket_offers_total ${offers.length}`);

  lines.push("# HELP openmarket_escrows_total Total escrows by status");
  lines.push("# TYPE openmarket_escrows_total gauge");
  lines.push(`openmarket_escrows_total{status="locked"} ${lockedEscrows}`);
  lines.push(`openmarket_escrows_total{status="released"} ${releasedEscrows}`);
  lines.push(`openmarket_escrows_total{status="refunded"} ${escrows.filter(e => e.status === "refunded").length}`);
  lines.push(`openmarket_escrows_total{status="disputed"} ${escrows.filter(e => e.status === "disputed").length}`);

  lines.push("# HELP openmarket_uptime_seconds Process uptime in seconds");
  lines.push("# TYPE openmarket_uptime_seconds gauge");
  lines.push(`openmarket_uptime_seconds ${uptimeSeconds}`);

  lines.push("# HELP openmarket_platform_fee_bps Platform fee in basis points");
  lines.push("# TYPE openmarket_platform_fee_bps gauge");
  lines.push(`openmarket_platform_fee_bps ${PLATFORM_FEE_BPS}`);

  // Config flags as 0/1
  lines.push("# HELP openmarket_config_info Configuration flags (1=enabled)");
  lines.push("# TYPE openmarket_config_info gauge");
  lines.push(`openmarket_config_info{flag="strict_settlement",network="${NETWORK}"} ${STRICT_SETTLEMENT ? 1 : 0}`);
  lines.push(`openmarket_config_info{flag="dev_fake_pay",network="${NETWORK}"} ${ALLOW_DEV_FAKE_SETTLEMENT ? 1 : 0}`);
  lines.push(`openmarket_config_info{flag="usdc_live",network="${NETWORK}"} ${usdcMeta().live ? 1 : 0}`);
  lines.push(`openmarket_config_info{flag="escrow_contract_live",network="${NETWORK}"} ${isEscrowContractLive() ? 1 : 0}`);

  const llm = llmMeta();
  lines.push(`openmarket_config_info{flag="llm_configured",network="${NETWORK}"} ${llm.configured ? 1 : 0}`);
  lines.push(`openmarket_config_info{flag="llm_enabled",network="${NETWORK}"} ${llm.enabled ? 1 : 0}`);

  // Agent reputation stats
  lines.push("# HELP openmarket_agent_sales_total Total sales by agent");
  lines.push("# TYPE openmarket_agent_sales_total gauge");
  for (const a of agents) {
    lines.push(`openmarket_agent_sales_total{agent="${a.id}",name="${a.name}"} ${a.stats.sales}`);
  }

  lines.push("# HELP openmarket_agent_success_rate Agent success rate");
  lines.push("# TYPE openmarket_agent_success_rate gauge");
  for (const a of agents) {
    const total = a.stats.success + a.stats.fail;
    const rate = total > 0 ? a.stats.success / total : 0;
    lines.push(`openmarket_agent_success_rate{agent="${a.id}",name="${a.name}"} ${rate.toFixed(4)}`);
  }

  // Runtime counters
  lines.push("# HELP openmarket_http_requests_total HTTP requests processed");
  lines.push("# TYPE openmarket_http_requests_total counter");
  for (const [name, value] of Object.entries(counters)) {
    lines.push(`openmarket_http_requests_total{route="${name}"} ${value}`);
  }

  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
