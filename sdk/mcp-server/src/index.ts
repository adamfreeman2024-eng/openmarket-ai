#!/usr/bin/env node
/**
 * OpenMarket.ai MCP Server (Model Context Protocol)
 * 
 * Allows AI agents (Claude, GPT, Gemini) to use OpenMarket marketplace
 * directly via MCP — no code needed.
 * 
 * Setup in Claude Desktop / MCP client:
 * {
 *   "mcpServers": {
 *     "openmarket": {
 *       "command": "npx",
 *       "args": ["-y", "@openmarket/mcp-server"],
 *       "env": {
 *         "OPENMARKET_URL": "https://openmarket.ai",
 *         "OPENMARKET_API_KEY": "omk_..."
 *       }
 *     }
 *   }
 * }
 * 
 * Tools exposed:
 *   - search_offers: Search marketplace for services
 *   - buy_service: Buy a service (one-shot)
 *   - create_offer: List a service for sale
 *   - list_offers: List all active offers
 *   - get_balance: Get agent stats and spending
 *   - market_health: Check marketplace status
 *   - list_capabilities: Show available service types
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// --- Config ---
const BASE_URL = process.env.OPENMARKET_URL || "http://localhost:3000";
const API_KEY = process.env.OPENMARKET_API_KEY || "";

// --- HTTP helper ---
async function api(
  path: string,
  method: string = "GET",
  body?: unknown
): Promise<unknown> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (API_KEY) headers["x-api-key"] = API_KEY;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: res.status };
  }
}

// --- MCP Server ---
const server = new Server(
  {
    name: "openmarket-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- Tools ---
const TOOLS = [
  {
    name: "search_offers",
    description:
      "Search the OpenMarket marketplace for agent services. Returns ranked results by price, success rate, and latency.",
    inputSchema: {
      type: "object" as const,
      properties: {
        capability: {
          type: "string",
          description:
            "Service capability to search for. Examples: text.translate, text.summarize, code.review, text.sentiment, text.classify, text.extract, text.reply, llm.complete",
        },
        q: {
          type: "string",
          description: "Full-text search query",
        },
        maxPrice: {
          type: "number",
          description: "Maximum price in HBAR",
        },
      },
    },
  },
  {
    name: "buy_service",
    description:
      "Buy a service from the marketplace in one call. Automatically handles quote → order → payment → fulfillment. For testing, use devFakePay=true. For real payments, first call without transactionId to get payment instructions, pay HBAR, then call again with transactionId.",
    inputSchema: {
      type: "object" as const,
      required: ["offerId"] as const,
      properties: {
        offerId: {
          type: "string",
          description: "Offer ID from search results",
        },
        input: {
          type: "object",
          description:
            "Service input. For text.translate: {text, targetLang}. For text.summarize: {text}. For code.review: {code}. For text.sentiment: {text}. For text.classify: {text, categories}. For text.extract: {text, fields}.",
        },
        transactionId: {
          type: "string",
          description: "Hedera transaction ID after payment (for real settlement)",
        },
        devFakePay: {
          type: "boolean",
          description: "Use fake payment for testing (dev mode only)",
        },
      },
    },
  },
  {
    name: "create_offer",
    description:
      "List a service for sale on the marketplace. Other agents can discover and buy it.",
    inputSchema: {
      type: "object" as const,
      required: ["capability", "title", "priceAmount"] as const,
      properties: {
        capability: {
          type: "string",
          description: "Service type: text.translate, code.review, text.summarize, etc.",
        },
        title: { type: "string", description: "Offer title" },
        description: { type: "string" },
        priceAmount: { type: "number", description: "Price in HBAR" },
        priceAsset: { type: "string", default: "HBAR" },
        fulfillmentType: {
          type: "string",
          enum: ["inline", "webhook", "manual", "llm"],
          default: "inline",
        },
        maxSeconds: { type: "integer", default: 30 },
        escrow: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "list_offers",
    description: "List all active offers on the marketplace.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_agent_stats",
    description: "Get your agent stats, spending, and reputation. Shows daily spend, sales, purchases, success rate.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "market_health",
    description: "Check marketplace health, version, and configuration flags.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "list_capabilities",
    description:
      "List all available service capabilities on the marketplace with descriptions and example inputs.",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

// --- Tool handler ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_offers": {
        const params = new URLSearchParams();
        if (args?.capability) params.set("capability", String(args.capability));
        if (args?.q) params.set("q", String(args.q));
        if (args?.maxPrice) params.set("maxPrice", String(args.maxPrice));
        const r = await api(`/api/v1/offers/search?${params}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(r, null, 2),
            },
          ],
        };
      }

      case "buy_service": {
        const body: Record<string, unknown> = { offerId: args?.offerId };
        if (args?.input) body.input = args.input;
        if (args?.transactionId) body.transactionId = args.transactionId;
        if (args?.devFakePay) body.devFakePay = true;
        const r = await api("/api/v1/buy", "POST", body);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(r, null, 2),
            },
          ],
        };
      }

      case "create_offer": {
        const r = await api("/api/v1/offers", "POST", args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(r, null, 2),
            },
          ],
        };
      }

      case "list_offers": {
        const r = await api("/api/v1/offers");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(r, null, 2),
            },
          ],
        };
      }

      case "get_agent_stats": {
        const r = await api("/api/v1/agents/me");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(r, null, 2),
            },
          ],
        };
      }

      case "market_health": {
        const r = await api("/api/v1/health");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(r, null, 2),
            },
          ],
        };
      }

      case "list_capabilities": {
        const caps = [
          {
            capability: "text.translate",
            description: "Translate text to a target language",
            exampleInput: { text: "Hello world", targetLang: "hy" },
            avgPrice: "0.01 HBAR",
          },
          {
            capability: "text.summarize",
            description: "Summarize long text into concise summary",
            exampleInput: { text: "Long article text..." },
            avgPrice: "0.01 HBAR",
          },
          {
            capability: "code.review",
            description: "Review code for bugs, security, best practices",
            exampleInput: { code: "function add(a,b){return a+b}" },
            avgPrice: "0.05 HBAR",
          },
          {
            capability: "text.sentiment",
            description: "Analyze sentiment of text (positive/negative/neutral)",
            exampleInput: { text: "I love this product!" },
            avgPrice: "0.01 HBAR",
          },
          {
            capability: "text.classify",
            description: "Classify text into categories",
            exampleInput: { text: "Breaking news...", categories: "sports,tech,politics" },
            avgPrice: "0.01 HBAR",
          },
          {
            capability: "text.extract",
            description: "Extract structured data from text",
            exampleInput: { text: "Email from John...", fields: "sender,date,subject" },
            avgPrice: "0.02 HBAR",
          },
          {
            capability: "text.reply",
            description: "Generate a reply to a message",
            exampleInput: { text: "Can you help me?" },
            avgPrice: "0.01 HBAR",
          },
          {
            capability: "llm.complete",
            description: "General LLM completion",
            exampleInput: { prompt: "Explain quantum computing" },
            avgPrice: "0.02 HBAR",
          },
          {
            capability: "echo.demo",
            description: "Echo service for testing (returns input)",
            exampleInput: { hello: "world" },
            avgPrice: "0.1 HBAR",
          },
          {
            capability: "delivery.demo",
            description: "Escrow demo service (locks payment until proof)",
            exampleInput: {},
            avgPrice: "0.5 HBAR",
          },
        ];
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ capabilities: caps }, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (e) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      isError: true,
    };
  }
});

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OpenMarket MCP server running (stdio)");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
