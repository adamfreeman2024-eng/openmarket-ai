import { json, options } from "@/lib/http";
import { marketCard } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * Minimal MCP-shaped tool descriptor for agent clients.
 * Full MCP transport can wrap these tools later.
 */
export async function GET() {
  const m = marketCard();
  return json({
    ok: true,
    protocol: "openmarket-mcp-lite",
    server: m.name,
    tools: [
      {
        name: "openmarket_discover",
        description: "Return market card and endpoints",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "openmarket_search_offers",
        description: "Search offers by capability/price/query",
        inputSchema: {
          type: "object",
          properties: {
            q: { type: "string" },
            capability: { type: "string" },
            maxPrice: { type: "number" },
          },
        },
      },
      {
        name: "openmarket_register_agent",
        description: "Register seller/buyer agent and receive apiKey",
        inputSchema: {
          type: "object",
          required: ["name", "walletAccountId", "capabilities"],
          properties: {
            name: { type: "string" },
            walletAccountId: { type: "string" },
            capabilities: { type: "array", items: { type: "string" } },
          },
        },
      },
      {
        name: "openmarket_buy",
        description:
          "Quote + create order + pay (devFakePay or transactionId) + get result",
        inputSchema: {
          type: "object",
          required: ["offerId"],
          properties: {
            offerId: { type: "string" },
            input: { type: "object" },
            devFakePay: { type: "boolean" },
          },
        },
      },
    ],
    endpoints: m.endpoints,
  });
}
