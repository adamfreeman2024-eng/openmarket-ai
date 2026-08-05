#!/usr/bin/env node
// End-to-end test: buy Hermes's own text.summarize offer with devFakePay.
const BASE = process.env.BASE || "http://127.0.0.1:3010";
const OFFER_ID = process.env.OFFER_ID || "off_E2DxhTJtqJ2e"; // text.summarize (hermes bot)

async function api(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, { headers: { "content-type": "application/json" }, ...opts });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

async function main() {
  const sample = "Hedera is a public distributed ledger technology (DLT) network. It uses a novel consensus mechanism called hashgraph which provides high throughput, low latency, and fair ordering of transactions. Unlike blockchain networks that rely on mining, Hedera achieves consensus through gossip about gossip and virtual voting. The network is governed by a council of global enterprises, and its native cryptocurrency is HBAR, which is used to pay for network services such as smart contracts, file storage, and transaction fees.";

  console.log("1️⃣  Quote...");
  const q = await api("/api/v1/quotes", {
    method: "POST",
    body: JSON.stringify({ offerId: OFFER_ID, input: { text: sample } }),
  });
  if (q.status !== 200) { console.log("❌ Quote failed:", JSON.stringify(q)); return; }
  const quoteId = q.j.quote?.id || q.j.id;
  const payTo = q.j.quote?.payTo;
  const total = q.j.quote?.totalAmount ?? q.j.totalAmount;
  console.log("   ✅ quote:", quoteId, "| payTo:", payTo, "| total:", total, q.j.quote?.priceAsset);

  console.log("2️⃣  Order...");
  const o = await api("/api/v1/orders", {
    method: "POST",
    body: JSON.stringify({ quoteId }),
  });
  const orderId = o.j.orderId || o.j.order?.id || o.j.id;
  console.log("   status:", o.status, "| orderId:", orderId, "| msg:", o.j.message || o.j.error || "");

  console.log("3️⃣  Pay (devFakePay)...");
  const t0 = Date.now();
  const p = await api(`/api/v1/orders/${orderId}/pay`, {
    method: "POST",
    body: JSON.stringify({ devFakePay: true }),
  });
  const dt = Date.now() - t0;
  console.log(`   status: ${p.status} (${dt}ms)`);
  if (p.j.order) {
    const ord = p.j.order;
    console.log("   order.status:", ord.status);
    console.log("   order.latencyMs:", ord.latencyMs);
    console.log("   result keys:", Object.keys(ord.result || {}));
    const txt = ord.result?.summary || ord.result?.result || ord.result;
    console.log("   RESULT:", String(txt).slice(0, 700));
    console.log("   error:", ord.error || "(none)");
  } else {
    console.log("   response:", JSON.stringify(p.j).slice(0, 500));
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
