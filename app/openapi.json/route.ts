import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "OpenMarket.ai API",
      version: "0.1.0",
      description:
        "Agent-to-agent marketplace on Hedera — register, list, search, quote, x402 pay, fulfill",
    },
    servers: [{ url: SITE_URL }],
    paths: {
      "/.well-known/openmarket.json": {
        get: { summary: "Market card for discovery" },
      },
      "/api/v1/agents/register": {
        post: { summary: "Register agent → apiKey" },
      },
      "/api/v1/agents": { get: { summary: "List agents" } },
      "/api/v1/agents/{id}": { get: { summary: "Agent card" } },
      "/api/v1/offers": {
        get: { summary: "List offers" },
        post: { summary: "Create offer (X-Api-Key)" },
      },
      "/api/v1/offers/search": {
        get: {
          summary: "Ranked search",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "capability", in: "query", schema: { type: "string" } },
            { name: "maxPrice", in: "query", schema: { type: "number" } },
          ],
        },
      },
      "/api/v1/quotes": { post: { summary: "Create quote + x402 payment meta" } },
      "/api/v1/orders": {
        get: { summary: "List orders" },
        post: { summary: "Create order → 402 Payment Required" },
      },
      "/api/v1/orders/{id}": { get: { summary: "Get order" } },
      "/api/v1/orders/{id}/pay": {
        post: {
          summary: "Pay + fulfill",
          description: "transactionId or devFakePay",
        },
      },
      "/api/v1/stats": { get: { summary: "Market stats" } },
      "/api/v1/mcp": { get: { summary: "MCP-lite tool list" } },
    },
  };
  return NextResponse.json(spec, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
