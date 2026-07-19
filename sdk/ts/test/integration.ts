/**
 * SDK integration test — tests TypeScript SDK against live server.
 * Run: npx tsx sdk/ts/test/integration.ts
 */
import { OpenMarket } from "../src/index";

const BASE = process.env.OPENMARKET_URL || "http://127.0.0.1:3010";

async function main() {
  console.log(`Testing SDK against ${BASE}\n`);

  const market = new OpenMarket({ baseUrl: BASE });

  // 1. Health check
  console.log("1. Health check...");
  const health = await market.health();
  console.log("   ✅", health.status, "v" + health.version);
  console.log("   agents:", health.agents, "offers:", health.offers);

  // 2. Market card
  console.log("\n2. Market card...");
  const card = await market.marketCard();
  console.log("   ✅", (card as { name?: string }).name);

  // 3. Search offers
  console.log("\n3. Search offers...");
  const search = await market.search({ capability: "echo.demo" });
  const offerId = search.results?.[0]?.offer?.id;
  console.log("   ✅ Found", search.results?.length, "offers, first:", offerId);

  if (!offerId) throw new Error("No offers found");

  // 4. Register agent
  console.log("\n4. Register agent...");
  const reg = await market.register({
    name: "SDK Test Agent",
    walletAccountId: "0.0.999999",
    capabilities: ["buyer"],
    policy: { dailySpendLimit: 100, maxPerTx: 10 },
  });
  console.log("   ✅ Agent:", reg.agentId, "key:", reg.apiKey?.slice(0, 10) + "...");

  // 5. Buy with devFakePay
  console.log("\n5. Buy (devFakePay)...");
  const buyResult = await market.buy(offerId, { hello: "sdk test" }, { devFakePay: true });
  console.log("   ✅ Order:", (buyResult as { order?: { id?: string } }).order?.id);
  console.log("   ✅ Status:", (buyResult as { order?: { status?: string } }).order?.status);
  console.log("   ✅ Result:", JSON.stringify((buyResult as { order?: { result?: unknown } }).order?.result));

  // 6. List offers
  console.log("\n6. List all offers...");
  const offers = await market.listOffers();
  console.log("   ✅", offers.offers?.length, "active offers");

  // 7. Get agent stats
  console.log("\n7. Agent stats...");
  const me = await market.me();
  console.log("   ✅", (me as { agent?: { name?: string } }).agent?.name);

  console.log("\n✅ ALL SDK TESTS PASSED");
}

main().catch((e) => {
  console.error("\n❌ SDK TEST FAILED:", e);
  process.exit(1);
});
