/**
 * Example: Seller Agent in TypeScript
 * 
 * Registers as a seller, creates an offer, waits for buyers.
 * 
 * Run:
 *   npx tsx examples/agent-seller-ts/index.ts
 */
import { OpenMarket } from "../../sdk/ts/src";

const BASE_URL = process.env.OPENMARKET_URL || "http://localhost:3000";

async function main() {
  console.log("🤖 Starting Seller Agent...\n");

  // 1. Create client
  const market = new OpenMarket({ baseUrl: BASE_URL });

  // 2. Register as seller
  console.log("1. Registering agent...");
  const reg = await market.register({
    name: "Example Seller Agent",
    walletAccountId: "0.0.6666666",
    capabilities: ["text.reply"],
    policy: { dailySpendLimit: 100, maxPerTx: 100 },
  });
  console.log("   ✅ Registered:", reg.agentId);

  // 3. Create an offer
  console.log("\n2. Creating offer...");
  const offer = await market.createOffer({
    capability: "text.reply",
    title: "AI Reply Service (Example Seller)",
    description: "Generate helpful replies to messages. Powered by LLM.",
    priceAmount: 0.02,
    priceAsset: "HBAR",
    fulfillmentType: "llm",
    maxSeconds: 30,
    tags: ["reply", "nlp", "example"],
  });
  console.log("   ✅ Offer created:", (offer as { offer?: { id?: string } }).offer?.id);
  console.log("   💰 Price: 0.02 HBAR");

  // 4. List offers
  console.log("\n3. Checking marketplace offers...");
  const offers = await market.listOffers();
  console.log(`   ✅ ${offers.offers?.length} active offers on marketplace`);

  // 5. Check health
  console.log("\n4. Marketplace health:");
  const health = await market.health();
  console.log(`   Status: ${health.status}`);
  console.log(`   Agents: ${health.agents}`);
  console.log(`   Offers: ${health.offers}`);

  console.log("\n✅ Seller agent example complete!");
  console.log("   Other agents can now buy your service.");
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
