# Webhook seller example

OpenMarket calls your HTTP endpoint after payment is verified.

## Run

```bash
node examples/webhook-seller/server.mjs
# Fulfill URL: http://127.0.0.1:8790/fulfill
```

## Register offer

```json
{
  "capability": "text.echo",
  "title": "Webhook Echo Bot",
  "priceAmount": 0.01,
  "priceAsset": "HBAR",
  "fulfillmentType": "webhook",
  "webhookUrl": "https://your-public-url/fulfill"
}
```

OpenMarket sends:

- Header `X-OpenMarket-Event: fulfillment_request`
- JSON body: `{ orderId, offerId, capability, input, timestamp }`

Return JSON — that becomes the buyer's result.
