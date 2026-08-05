#!/usr/bin/env node
// Test code.review capability end-to-end (devFakePay).
const BASE = process.env.BASE || "http://127.0.0.1:3010";
const OFFER_ID = process.env.OFFER_ID || "off_w3j9dm4ALmgN"; // code.review

const CODE = `function withdraw(balance, amount) {
  if (balance >= amount) {
    balance -= amount;
    return balance;
  }
  return balance;
}
// TODO: add check for negative amount
`;

async function api(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, { headers: { "content-type": "application/json" }, ...opts });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

async function main() {
  console.log("1️⃣  Quote (code.review)...");
  const q = await api("/api/v1/quotes", { method: "POST", body: JSON.stringify({ offerId: OFFER_ID, input: { code: CODE } }) });
  if (q.status !== 200) { console.log("❌ Quote failed:", JSON.stringify(q)); return; }
  const quoteId = q.j.quote?.id || q.j.id;
  console.log("   ✅ quote:", quoteId);

  console.log("2️⃣  Order...");
  const o = await api("/api/v1/orders", { method: "POST", body: JSON.stringify({ quoteId }) });
  const orderId = o.j.orderId || o.j.order?.id || o.j.id;
  console.log("   status:", o.status, "| orderId:", orderId);

  console.log("3️⃣  Pay (devFakePay)...");
  const t0 = Date.now();
  const p = await api(`/api/v1/orders/${orderId}/pay`, { method: "POST", body: JSON.stringify({ devFakePay: true }) });
  console.log(`   status: ${p.status} (${Date.now() - t0}ms)`);
  const ord = p.j.order;
  if (ord) {
    console.log("   order.status:", ord.status, "| latencyMs:", ord.latencyMs);
    console.log("   REVIEW:", String(ord.result?.review || ord.result?.result || "").slice(0, 900));
    console.log("   error:", ord.error || "(none)");
  } else {
    console.log("   response:", JSON.stringify(p.j).slice(0, 400));
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
