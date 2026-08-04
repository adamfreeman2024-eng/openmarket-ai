import { db, ensureSeedCatalog } from "@/lib/store";
import { reputationForApi } from "@/lib/reputation";
import { isEscrowContractLive } from "@/lib/onchain-escrow";
import { ALLOW_DEV_FAKE_SETTLEMENT, NETWORK, PLATFORM_FEE_BPS } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /dashboard — HTML marketplace overview */
export async function GET() {
  ensureSeedCatalog();

  const agents = db.listAgents();
  const offers = db.listOffers();
  const orders = db.listOrders();
  const escrows = db.listEscrows();

  const completed = orders.filter((o) => o.status === "completed").length;
  const failed = orders.filter((o) => o.status === "failed").length;
  const lockedEscrows = escrows.filter((e) => e.status === "locked").length;

  // Revenue by asset (completed orders only)
  const hbarVolume = orders
    .filter((o) => o.status === "completed" && o.priceAsset === "HBAR")
    .reduce((s, o) => s + (o.totalAmount ?? 0), 0);
  const usdcVolume = orders
    .filter((o) => o.status === "completed" && o.priceAsset === "USDC")
    .reduce((s, o) => s + (o.totalAmount ?? 0), 0);

  // Settlement status flag
  const settlementFlag = ALLOW_DEV_FAKE_SETTLEMENT
    ? '<span class="badge yellow">TESTNET</span>'
    : '<span class="badge live">STRICT</span>';

  // Internal ledger
  const ledgerTotal = agents.reduce((s, a) => s + Number(a.internalBalance ?? 0), 0);
  const agentsWithBalance = agents.filter((a) => Number(a.internalBalance ?? 0) > 0).length;

  // Capability distribution bars
  const capCounts = new Map<string, number>();
  for (const o of offers) {
    capCounts.set(o.capability, (capCounts.get(o.capability) || 0) + 1);
  }
  const capEntries = [...capCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const capMax = capEntries.length ? capEntries[0][1] : 1;
  const capabilityBars = capEntries.length
    ? capEntries
        .map(
          ([cap, n]) =>
            `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;"><span style="width:200px;font-size:12px;color:#94a3b8;font-family:monospace;">${cap}</span><div style="flex:1;background:#1e293b;border-radius:4px;overflow:hidden;"><div style="width:${Math.round((n / capMax) * 100)}%;background:#38bdf8;height:14px;border-radius:4px;"></div></div><span style="width:30px;font-size:12px;color:#e2e8f0;">${n}</span></div>`
        )
        .join("")
    : '<p style="color:#64748b;font-size:13px;">No offers yet</p>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentBazaar — Dashboard</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; }
.header { background: linear-gradient(135deg, #1e293b, #334155); padding: 24px 32px; border-bottom: 1px solid #475569; }
.header h1 { font-size: 24px; color: #38bdf8; }
.header .sub { font-size: 14px; color: #94a3b8; margin-top: 4px; }
.container { max-width: 1200px; margin: 0 auto; padding: 24px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
.card { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }
.card .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }
.card .value { font-size: 32px; font-weight: 700; color: #38bdf8; margin-top: 8px; }
.card .value.green { color: #4ade80; }
.card .value.red { color: #f87171; }
.card .value.yellow { color: #fbbf24; }
.section { margin-bottom: 32px; }
.section h2 { font-size: 18px; color: #e2e8f0; margin-bottom: 16px; border-bottom: 1px solid #334155; padding-bottom: 8px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 12px; color: #64748b; font-size: 12px; text-transform: uppercase; border-bottom: 1px solid #334155; }
td { padding: 12px; border-bottom: 1px solid #1e293b; font-size: 14px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
.badge.live { background: #064e3b; color: #4ade80; }
.badge.off { background: #450a0a; color: #f87171; }
.badge.trust-4 { background: #1e3a5f; color: #38bdf8; }
.badge.trust-3 { background: #1e3a5f; color: #60a5fa; }
.badge.trust-2 { background: #334155; color: #94a3b8; }
.badge.trust-1 { background: #334155; color: #64748b; }
.badge.trust-0 { background: #1e293b; color: #475569; }
.footer { text-align: center; padding: 24px; color: #475569; font-size: 12px; }
</style>
</head>
<body>
<div class="header">
<h1>🏪 AgentBazaar</h1>
<div class="sub">Agent-to-agent marketplace on Hedera — Network: ${NETWORK} — Fee: ${PLATFORM_FEE_BPS / 100}% — v1.3.0 · agentbazaar.app</div>
</div>
<div class="container">

<div class="grid">
<div class="card"><div class="label">Agents</div><div class="value">${agents.length}</div></div>
<div class="card"><div class="label">Offers</div><div class="value">${offers.length}</div></div>
<div class="card"><div class="label">Completed Orders</div><div class="value green">${completed}</div></div>
<div class="card"><div class="label">Failed Orders</div><div class="value red">${failed}</div></div>
<div class="card"><div class="label">Locked Escrows</div><div class="value yellow">${lockedEscrows}</div></div>
<div class="card"><div class="label">Escrow Contract</div><div class="value">${isEscrowContractLive() ? '<span class="badge live">LIVE</span>' : '<span class="badge off">OFF</span>'}</div></div>
<div class="card"><div class="label">HBAR Volume</div><div class="value green">${hbarVolume} ℏ</div></div>
<div class="card"><div class="label">USDC Volume</div><div class="value">${usdcVolume} USDC</div></div>
<div class="card"><div class="label">Settlement</div><div class="value">${settlementFlag}</div></div>
<div class="card"><div class="label">💰 Ledger Balance</div><div class="value green">${ledgerTotal.toFixed(2)}</div></div>
<div class="card"><div class="label">Agents w/ Balance</div><div class="value">${agentsWithBalance}</div></div>
</div>

<div class="section">
<h2>💊 Capability Distribution</h2>
${capabilityBars}
</div>

<div class="section">
<h2>🏆 Top Agents by Reputation</h2>
<table>
<tr><th>Agent</th><th>Capabilities</th><th>Score</th><th>Trust</th><th>Badges</th><th>💰</th><th>Sales</th><th>Success Rate</th></tr>
${agents.map((a) => {
  const orderCount = orders.filter((o) => o.sellerAgentId === a.id).length;
  const rep = reputationForApi(a, escrows, orderCount);
  const total = a.stats.success + a.stats.fail;
  const rate = total > 0 ? ((a.stats.success / total) * 100).toFixed(0) + '%' : '—';
  const earnedBadges = rep.badges.filter((b) => b.earned).map((b) => b.icon).join(' ') || '—';
  const bal = Number(a.internalBalance ?? 0);
  return `<tr>
<td><strong>${a.name}</strong><br><small style="color:#475569">${a.id}</small></td>
<td>${a.capabilities.join(', ')}</td>
<td>${rep.score}/100</td>
<td><span class="badge trust-${rep.trustLevel}">${rep.trustLabel}</span></td>
<td>${earnedBadges}</td>
<td>${bal > 0 ? bal.toFixed(2) : '—'}</td>
<td>${a.stats.sales}</td>
<td>${rate}</td>
</tr>`;
}).join('')}
</table>
</div>

<div class="section">
<h2>📦 Active Offers</h2>
<table>
<tr><th>Capability</th><th>Title</th><th>Price</th><th>Seller</th><th>Escrow</th><th>Tags</th></tr>
${offers.map((o) => {
  const seller = agents.find((a) => a.id === o.agentId);
  return `<tr>
<td><code>${o.capability}</code></td>
<td>${o.title}</td>
<td>${o.priceAmount} ${o.priceAsset}</td>
<td>${seller?.name || 'unknown'}</td>
<td>${o.escrow ? '🔒' : '—'}</td>
<td>${o.tags.join(', ')}</td>
</tr>`;
}).join('')}
</table>
</div>

<div class="section">
<h2>🕒 Recent Orders</h2>
<table>
<tr><th>Order</th><th>Capability</th><th>Seller</th><th>Buyer</th><th>Amount</th><th>Status</th><th>When</th></tr>
${orders.slice(0, 15).map((o) => {
  const seller = agents.find((a) => a.id === o.sellerAgentId);
  const buyer = agents.find((a) => a.id === o.buyerAgentId);
  const statusColor = o.status === 'completed' ? 'green' : o.status === 'failed' ? 'red' : 'yellow';
  return `<tr>
<td><code>${o.id}</code></td>
<td><code>${o.offerId || '—'}</code></td>
<td>${seller?.name || 'unknown'}</td>
<td>${buyer?.name || o.buyerWallet || '—'}</td>
<td>${o.totalAmount != null ? o.totalAmount : '—'} ${o.priceAsset || ''}</td>
<td><span class="badge" style="background:${o.status === 'completed' ? '#064e3b' : o.status === 'failed' ? '#450a0a' : '#451a03'};color:${o.status === 'completed' ? '#4ade80' : o.status === 'failed' ? '#f87171' : '#fbbf24'}">${o.status}</span></td>
<td>${new Date(o.createdAt || Date.now()).toLocaleString()}</td>
</tr>`;
}).join('')}
</table>
</div>

<div class="section">
<h2>🔒 Active Escrows</h2>
<table>
<tr><th>Escrow</th><th>Order</th><th>Amount</th><th>Asset</th><th>Seller</th><th>Status</th><th>Expires</th></tr>
${escrows.slice(0, 10).map((e) => {
  const seller = agents.find((a) => a.id === e.sellerAgentId);
  return `<tr>
<td><code>${e.id}</code></td>
<td><code>${e.orderId}</code></td>
<td>${e.amount}</td>
<td>${e.asset}</td>
<td>${seller?.name || 'unknown'}</td>
<td><span class="badge" style="background:${e.status === 'released' ? '#064e3b' : e.status === 'refunded' ? '#450a0a' : '#1e3a5f'};color:${e.status === 'released' ? '#4ade80' : e.status === 'refunded' ? '#f87171' : '#60a5fa'}">${e.status}</span></td>
<td>${e.expiresAt ? new Date(e.expiresAt).toLocaleString() : '—'}</td>
</tr>`;
}).join('')}
</table>
</div>

</div>
<div class="footer">
AgentBazaar v1.3.0 — ${new Date().toISOString()} — <a href="/api/v1/dashboard" style="color:#38bdf8">API</a> | <a href="/api/v1/metrics" style="color:#38bdf8">Metrics</a> | <a href="/openapi.json" style="color:#38bdf8">OpenAPI</a> | <a href="/" style="color:#38bdf8">Home</a>
</div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
