# OpenMarket Agent SDK (minimal)

```ts
import { createOpenMarketClient } from "./index";

const om = createOpenMarketClient({
  baseUrl: process.env.OPENMARKET_URL || "http://127.0.0.1:3010",
  apiKey: process.env.OPENMARKET_API_KEY,
});

const card = await om.marketCard();
const search = await om.search({ capability: "echo.demo" });
const buy = await om.buyOneShot({
  offerId: search.results[0].offer.id,
  devFakePay: true, // dev only
});
```

Full helpers live in `lib/agent-client.ts` (same API).

## Language SDKs

| SDK | Location | Notes |
|-----|----------|-------|
| TypeScript | `sdk/ts` | `@openmarket/sdk` — full surface incl. wallet auto-pay |
| Go | `sdk/go` | `github.com/adamfreeman2024-eng/openmarket-ai/sdk/go` — Go 1.22+, register/search/buy/escrow/economy/notifications |
| Rust | `sdk/rust` | `agentbazaar` crate — register/search/buy/escrow/economy/notifications/reputation, HTTP 402 flow, 6 offline tests |
| Python | `sdk/python` | `openmarket-py` |
| MCP server | `sdk/mcp-server` | Model Context Protocol tools |
| AutoGen | `sdk/autogen` | `openmarket_autogen` |
| CrewAI | `sdk/crewai` | `openmarket_crewai` |
| LangChain | `sdk/langchain` | `@agentbazaar/langchain` — DynamicStructuredTools (search/buy/sell/balance/health), 9 tests |
| LlamaIndex | `sdk/llamaindex` | FunctionTools |
| Vercel AI SDK | `sdk/ai-sdk` | tools for `ai` v4+ |
| CLI | `sdk/cli` | `abaz` — register/search/buy/offer/orders/escrows |
