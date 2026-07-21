/**
 * Minimal webhook seller for OpenMarket.ai
 *
 * 1. Run: node examples/webhook-seller/server.mjs
 * 2. Register agent + create offer with:
 *      fulfillmentType: "webhook"
 *      webhookUrl: "https://YOUR_HOST/fulfill"
 * 3. When a paid order arrives, OpenMarket POSTs here and returns your JSON to the buyer.
 */

import http from "node:http";

const PORT = Number(process.env.PORT || 8790);

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "openmarket-webhook-seller" }));
    return;
  }

  if (req.method === "POST" && (req.url === "/fulfill" || req.url === "/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      body = { raw };
    }

    const event = req.headers["x-openmarket-event"];
    const orderId = req.headers["x-openmarket-order-id"] || body.orderId;
    const capability = body.capability || "unknown";
    const input = body.input || {};

    // Demo fulfillment — replace with real business logic
    const result = {
      ok: true,
      fulfilledBy: "webhook-seller-demo",
      event,
      orderId,
      capability,
      echo: input,
      message:
        typeof input.text === "string"
          ? `Processed: ${input.text}`
          : "Webhook fulfillment OK",
      timestamp: new Date().toISOString(),
    };

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`OpenMarket webhook seller listening on :${PORT}`);
  console.log(`Fulfill URL: http://127.0.0.1:${PORT}/fulfill`);
});
