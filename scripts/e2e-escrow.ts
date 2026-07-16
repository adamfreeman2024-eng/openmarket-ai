/** Full escrow e2e: register buyer → buy escrow offer → release */
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";

async function j(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, init);
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function main() {
  console.log("Escrow E2E →", BASE);
  const reg = await j("/api/v1/agents/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Escrow Buyer",
      walletAccountId: "0.0.88001",
      capabilities: ["buyer"],
      policy: { dailySpendLimit: 100, maxPerTx: 10 },
    }),
  });
  const key = reg.body.apiKey as string;
  const search = await j("/api/v1/offers/search?capability=delivery.demo");
  const offerId = search.body.results?.[0]?.offer?.id;
  if (!offerId) throw new Error("no delivery.demo offer");

  const buy = await j("/api/v1/buy", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      offerId,
      input: { parcel: "demo" },
      devFakePay: true,
    }),
  });
  console.log("buy", buy.status, buy.body.order?.status, buy.body.escrow?.id);
  const esc = buy.body.escrow?.id as string;
  if (!esc) throw new Error("no escrow");

  const rel = await j(`/api/v1/escrow/${esc}/release`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proof: "TRK-E2E-OK" }),
  });
  console.log(
    "release",
    rel.status,
    rel.body.escrow?.status,
    rel.body.order?.status
  );
  if (rel.body.order?.status !== "completed") process.exitCode = 1;
  else console.log("ESCROW_E2E_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
