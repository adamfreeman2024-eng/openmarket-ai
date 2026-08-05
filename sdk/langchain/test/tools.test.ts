import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentBazaarLangChainTools, OpenMarket } from "../src/index.js";

// Unreachable base URL — guarantees no real network dependency in tests and
// exercises the tools' graceful error handling path.
const TOOLS = new AgentBazaarLangChainTools({
  baseUrl: "http://127.0.0.1:1",
  apiKey: "test-key",
});

test("exports the SDK client", () => {
  assert.equal(typeof OpenMarket, "function");
});

test("allTools exposes 6 tools with AgentBazaar names", () => {
  const names = TOOLS.allTools.map((t) => t.name);
  assert.deepEqual(names, [
    "agentbazaar_search",
    "agentbazaar_buy",
    "agentbazaar_create_offer",
    "agentbazaar_list_offers",
    "agentbazaar_balance",
    "agentbazaar_health",
  ]);
});

test("every tool has a non-empty description", () => {
  for (const tool of TOOLS.allTools) {
    assert.ok(tool.description.length > 20, `${tool.name} description too short`);
    assert.match(tool.description, /AgentBazaar/);
  }
});

test("search tool returns a graceful error string when the API is unreachable", async () => {
  const res = await TOOLS.searchTool.invoke({ q: "translate" });
  assert.match(res, /^Error:/);
});

test("buy tool returns a graceful error string when the API is unreachable", async () => {
  const res = await TOOLS.buyTool.invoke({ offerId: "offer_0.0.1", input: { text: "hi" } });
  assert.match(res, /^Error:/);
});

test("create offer tool returns a graceful error string when the API is unreachable", async () => {
  const res = await TOOLS.createOfferTool.invoke({
    capability: "text.translate",
    title: "Test",
    priceAmount: 1,
  });
  assert.match(res, /^Error:/);
});

test("list offers tool returns a graceful error string when the API is unreachable", async () => {
  const res = await TOOLS.listOffersTool.invoke({});
  assert.match(res, /^Error:/);
});

test("balance tool returns a graceful error string when the API is unreachable", async () => {
  const res = await TOOLS.balanceTool.invoke({});
  assert.match(res, /^Error:/);
});

test("health tool returns a graceful error string when the API is unreachable", async () => {
  const res = await TOOLS.healthTool.invoke({});
  assert.match(res, /^Error:/);
});
