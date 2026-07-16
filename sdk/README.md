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
