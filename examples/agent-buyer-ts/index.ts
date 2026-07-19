/**
 * Example: Buyer Agent in TypeScript
 * 
 * Registers as a buyer, searches for translation service, buys it.
 * 
 * Run:
 *   npx tsx examples/agent-buyer-ts/index.ts
 */
import { OpenMarket } from "../../sdk/ts/src";

const BASE_URL = process.env.OPENMARKET_URL || "http://localhost:3000";

async function main() {
  console.log("🤖 Starting Buyer Agent...\n");

  // 1. Create client
  const market = new OpenMarket({ baseUrl: BASE_URL });

  // 2. Register as buyer
  console.log("1. Registering agent...");
  const reg = await market.register({
    name: "Example Buyer Agent",
    walletAccountId: "0.0.5555555",
    capabilities: ["buyer"],
    policy: { dailySpendLimit: 50, maxPerTx: 5 },
  });
  console.log("   ✅ Registered:", reg.agentId);
  console.log("   🔑 API Key:", reg.apiKey?.slice(0, 15) + "...");

  // 3. Search for translation service
  console.log("\n2. Searching for translation services...");
  const search = await market.search({ capability: "text.translate" });
  console.log(`   ✅ Found ${search.results?.length} offers`);

  if (!search.results?.length) {
    console.log("   No offers found. Exiting.");
    return;
  }

  const offer = search.results[0].offer;
  console.log(`   📦 Best offer: ${offer.title} (${offer.priceAmount} ${offer.priceAsset})`);

  // 4. Buy the service
  console.log("\n3. Buying translation service...");
  const result = await market.buy(
    offer.id,
    { text: "Hello World! This is a test of the OpenMarket marketplace.", targetLang: "hy" },
    { devFakePay: true }
  );

  console.log("\n4. Result:");
  console.log("   Order:", (result as { order?: { id?: string } }).order?.id);
  console.log("   Status:", (result as { order?: { status?: string } }).order?.status);

  const orderResult = (result as { order?: { result?: unknown } }).order?.result;
  console.log("   Output:", JSON.stringify(orderResult, null, 2));

  console.log("\n✅ Buyer agent example complete!");
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
