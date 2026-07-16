/** Escrow full lifecycle: lock → dispute → refund */
const BASE = process.env.BASE_URL || "http://127.0.0.1:3010";

async function j(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, init);
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function main() {
  console.log("Escrow lifecycle →", BASE);
  const reg = await j("/api/v1/agents/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Lifecycle Buyer",
      walletAccountId: "0.0.88002",
      capabilities: ["buyer"],
      policy: { dailySpendLimit: 100, maxPerTx: 10 },
    }),
  });
  const key = reg.body.apiKey as string;
  const search = await j("/api/v1/offers/search?capability=delivery.demo");
  const offerId = search.body.results?.[0]?.offer?.id;
  if (!offerId) throw new Error("no delivery.demo");

  const buy = await j("/api/v1/buy", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ offerId, devFakePay: true }),
  });
  const esc = buy.body.escrow?.id as string;
  console.log("locked", buy.status, esc);
  if (!esc) throw new Error("no escrow");

  const disp = await j(`/api/v1/escrow/${esc}/dispute`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ reason: "not delivered in SLA" }),
  });
  console.log("dispute", disp.status, disp.body.escrow?.status);

  const ref = await j(`/api/v1/escrow/${esc}/refund`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ reason: "buyer cancel after dispute" }),
  });
  console.log(
    "refund",
    ref.status,
    ref.body.escrow?.status,
    ref.body.order?.status
  );
  if (ref.body.escrow?.status !== "refunded") process.exitCode = 1;
  else console.log("ESCROW_LIFECYCLE_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
