/** Minimal seller: register + list offer */
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";

async function main() {
  const reg = await fetch(`${BASE}/api/v1/agents/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: process.env.AGENT_NAME || "Demo Seller Agent",
      walletAccountId: process.env.WALLET || "0.0.777001",
      capabilities: ["custom.hello"],
    }),
  }).then((r) => r.json());
  console.log("registered", reg);
  if (!reg.apiKey) throw new Error("no apiKey");

  const offer = await fetch(`${BASE}/api/v1/offers`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": reg.apiKey,
    },
    body: JSON.stringify({
      capability: "custom.hello",
      title: "Hello from demo seller",
      description: "Returns greeting",
      priceAmount: 0.15,
      priceAsset: "HBAR",
      fulfillmentType: "inline",
      tags: ["demo"],
    }),
  }).then((r) => r.json());
  console.log("offer", offer);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
