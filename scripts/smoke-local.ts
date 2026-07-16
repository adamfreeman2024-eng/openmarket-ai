/**
 * End-to-end smoke against a running server (or import store in-process).
 * Usage: BASE_URL=http://localhost:3000 npx tsx scripts/smoke-local.ts
 */
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";

async function j(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, init);
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function main() {
  console.log("OpenMarket smoke →", BASE);

  const card = await j("/.well-known/openmarket.json");
  console.log("market", card.status, card.body.name);

  const reg = await j("/api/v1/agents/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Smoke Buyer",
      walletAccountId: "0.0.424242",
      capabilities: ["buyer"],
      policy: { dailySpendLimit: 100, maxPerTx: 10 },
    }),
  });
  console.log("register", reg.status, reg.body.agentId);
  const apiKey = reg.body.apiKey as string;

  const search = await j("/api/v1/offers/search?capability=echo.demo");
  const offerId = search.body.results?.[0]?.offer?.id;
  console.log("search", search.status, "offer", offerId);
  if (!offerId) throw new Error("no seed offer");

  const quote = await j("/api/v1/quotes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      offerId,
      input: { hello: "openmarket" },
    }),
  });
  console.log("quote", quote.status, quote.body.quote?.id);
  const quoteId = quote.body.quote.id;

  const order = await j("/api/v1/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ quoteId }),
  });
  console.log("order", order.status, order.body.orderId); // 402
  const orderId = order.body.orderId;

  const pay = await j(`/api/v1/orders/${orderId}/pay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ devFakePay: true }),
  });
  console.log("pay", pay.status, pay.body.order?.status, pay.body.order?.result);

  const stats = await j("/api/v1/stats");
  console.log("stats", stats.body.completed, "completed");

  if (pay.body.order?.status !== "completed") {
    process.exitCode = 1;
    console.error("SMOKE FAIL");
  } else {
    console.log("SMOKE OK");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
