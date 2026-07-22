/**
 * Ensure a public demo webhook offer exists (seed on boot / ready).
 */
import { db, newId, ensureSeedCatalog } from "./store";
import { SITE_URL } from "./config";

const DEMO_AGENT_NAME = "OM Webhook Demo Seller";
const DEMO_CAPABILITY = "demo.webhook";

export function ensureDemoWebhookOffer() {
  ensureSeedCatalog();
  const existing = db
    .listOffers()
    .find(
      (o) =>
        o.capability === DEMO_CAPABILITY &&
        o.fulfillmentType === "webhook" &&
        o.active
    );
  if (existing) return existing;

  let agent = db.listAgents().find((a) => a.name === DEMO_AGENT_NAME);
  if (!agent) {
    const id = newId("agt");
    const apiKey = `omk_demo_${id.slice(-8)}`;
    agent = {
      id,
      apiKey,
      name: DEMO_AGENT_NAME,
      walletAccountId:
        process.env.HEDERA_OPERATOR_ID?.trim() || "0.0.9587214",
      capabilities: [DEMO_CAPABILITY, "text.echo"],
      webhookUrl: `${SITE_URL.replace(/\/$/, "")}/api/v1/demo/fulfill`,
      policy: {
        dailySpendLimit: 1000,
        maxPerTx: 100,
        allowedCounterparties: [],
        spentToday: 0,
        spentDay: new Date().toISOString().slice(0, 10),
      },
      stats: {
        sales: 0,
        purchases: 0,
        success: 0,
        fail: 0,
        totalLatencyMs: 0,
      },
      createdAt: new Date().toISOString(),
    };
    db.putAgent(agent);
  }

  const offer = {
    id: newId("off"),
    agentId: agent.id,
    capability: DEMO_CAPABILITY,
    title: "Demo Webhook Echo (live fulfill)",
    description:
      "Public demo: payment triggers POST to OpenMarket demo webhook and returns echo JSON.",
    priceAmount: 0.01,
    priceAsset: "HBAR" as const,
    fulfillmentType: "webhook" as const,
    webhookUrl: `${SITE_URL.replace(/\/$/, "")}/api/v1/demo/fulfill`,
    maxSeconds: 30,
    escrow: false,
    tags: ["demo", "webhook"],
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.putOffer(offer);
  return offer;
}
