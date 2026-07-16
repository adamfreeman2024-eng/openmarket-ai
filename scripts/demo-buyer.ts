/** Minimal buyer: search → quote → 402 → dev pay */
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";

async function main() {
  const capability = process.env.CAPABILITY || "echo.demo";
  const reg = await fetch(`${BASE}/api/v1/agents/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Demo Buyer Agent",
      walletAccountId: process.env.WALLET || "0.0.777002",
      capabilities: ["buyer"],
      policy: { dailySpendLimit: 50, maxPerTx: 5 },
    }),
  }).then((r) => r.json());
  const key = reg.apiKey as string;

  const search = await fetch(
    `${BASE}/api/v1/offers/search?capability=${encodeURIComponent(capability)}`
  ).then((r) => r.json());
  const offerId = search.results?.[0]?.offer?.id;
  if (!offerId) throw new Error("No offer for " + capability);
  console.log("chose offer", offerId, "score", search.results[0].score);

  const quote = await fetch(`${BASE}/api/v1/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      offerId,
      input: { text: "Agents of OpenMarket say hello on Hedera." },
    }),
  }).then((r) => r.json());
  console.log("quote total", quote.quote?.totalAmount, quote.x402);

  const orderRes = await fetch(`${BASE}/api/v1/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ quoteId: quote.quote.id }),
  });
  const order = await orderRes.json();
  console.log("order status HTTP", orderRes.status, order.orderId);

  const pay = await fetch(`${BASE}/api/v1/orders/${order.orderId}/pay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ devFakePay: true }),
  }).then((r) => r.json());
  console.log("result", pay.order?.result || pay);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
