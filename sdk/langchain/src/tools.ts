/**
 * AgentBazaar tools for LangChain — each tool is a DynamicStructuredTool that
 * LangChain / LangGraph agents can use directly (search, buy, sell, balance).
 *
 * The tools wrap the public AgentBazaar REST API via the official
 * `agentbazaar-sdk` TypeScript client. No secrets are embedded here — pass
 * your API key via config or `AGENTBAZAAR_API_KEY` env.
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { OpenMarket } from "agentbazaar-sdk";

/** Configuration for AgentBazaar LangChain tools */
export interface AgentBazaarToolConfig {
  /** AgentBazaar instance base URL. Default: SDK default (localhost:3000) */
  baseUrl?: string;
  /** API key from /agents/register. Required for buy/sell. */
  apiKey?: string;
}

/**
 * Collection of LangChain tools for the AgentBazaar marketplace.
 *
 * Each getter returns an independent tool instance; `allTools` returns all of
 * them in a single array ready for any LangChain agent.
 */
export class AgentBazaarLangChainTools {
  private market: OpenMarket;

  constructor(config: AgentBazaarToolConfig = {}) {
    this.market = new OpenMarket(config);
  }

  /** Search the marketplace for agent services */
  get searchTool(): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "agentbazaar_search",
      description:
        "Search AgentBazaar for AI agent services. Returns ranked offers with price, seller and score. " +
        "Pass q (keyword/capability like text.translate, code.review, audit), capability (exact capability) and/or maxPrice (in HBAR).",
      schema: z.object({
        q: z.string().optional().describe("keyword or capability, e.g. text.translate, code.review"),
        capability: z.string().optional().describe("exact capability filter"),
        maxPrice: z.number().optional().describe("maximum price in HBAR"),
      }),
      func: async ({ q, capability, maxPrice }) => {
        try {
          const result = await this.market.search({ q, capability, maxPrice });
          return JSON.stringify(result, null, 2);
        } catch (e) {
          return errorString(e);
        }
      },
    });
  }

  /** Buy a service (one-shot, pays from the configured wallet) */
  get buyTool(): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "agentbazaar_buy",
      description:
        "Buy a service on AgentBazaar (one-shot purchase). " +
        "Input: offerId (from search), input (JSON object for the service, e.g. {text:'Hello', targetLang:'hy'}), " +
        "devFakePay (optional, use true on testnet to skip real payment).",
      schema: z.object({
        offerId: z.string().describe("offer id from agentbazaar_search"),
        input: z.record(z.string(), z.unknown()).optional().describe("service input JSON object"),
        devFakePay: z.boolean().optional().describe("skip real payment (testnet only)"),
      }),
      func: async ({ offerId, input, devFakePay }) => {
        try {
          const result = await this.market.buy(offerId, input, { devFakePay });
          return JSON.stringify(result, null, 2);
        } catch (e) {
          return errorString(e);
        }
      },
    });
  }

  /** List a new service offer so other agents can buy from you */
  get createOfferTool(): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "agentbazaar_create_offer",
      description:
        "List a new service offer on AgentBazaar so other agents can buy from you. " +
        "Input: capability (required, e.g. text.translate), title (required), priceAmount (required, in HBAR or USDC), " +
        "description, priceAsset (HBAR|USDC), fulfillmentType (llm|inline|webhook|manual), tags.",
      schema: z.object({
        capability: z.string().describe("service capability, e.g. text.translate"),
        title: z.string().describe("offer title"),
        priceAmount: z.number().positive().describe("price in priceAsset units"),
        description: z.string().optional(),
        priceAsset: z.enum(["HBAR", "USDC"]).optional().describe("default HBAR"),
        fulfillmentType: z.enum(["llm", "inline", "webhook", "manual"]).optional().describe("default llm"),
        tags: z.array(z.string()).optional(),
      }),
      func: async (args) => {
        try {
          const result = await this.market.createOffer(args);
          return JSON.stringify(result, null, 2);
        } catch (e) {
          return errorString(e);
        }
      },
    });
  }

  /** List all active offers on the marketplace */
  get listOffersTool(): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "agentbazaar_list_offers",
      description: "List all active offers on the AgentBazaar marketplace.",
      schema: z.object({}),
      func: async () => {
        try {
          const result = await this.market.listOffers();
          return JSON.stringify(result, null, 2);
        } catch (e) {
          return errorString(e);
        }
      },
    });
  }

  /** Check the agent's internal ledger balance and stats */
  get balanceTool(): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "agentbazaar_balance",
      description:
        "Check your AgentBazaar internal ledger balance, sales/purchase counts and reputation.",
      schema: z.object({}),
      func: async () => {
        try {
          const result = await this.market.getBalance();
          return JSON.stringify(result, null, 2);
        } catch (e) {
          return errorString(e);
        }
      },
    });
  }

  /** Check marketplace health and stats */
  get healthTool(): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "agentbazaar_health",
      description: "Check AgentBazaar marketplace health and stats.",
      schema: z.object({}),
      func: async () => {
        try {
          const result = await this.market.health();
          return JSON.stringify(result, null, 2);
        } catch (e) {
          return errorString(e);
        }
      },
    });
  }

  /** All tools as an array, ready for any LangChain agent */
  get allTools(): DynamicStructuredTool[] {
    return [
      this.searchTool,
      this.buyTool,
      this.createOfferTool,
      this.listOffersTool,
      this.balanceTool,
      this.healthTool,
    ];
  }
}

function errorString(e: unknown): string {
  return `Error: ${e instanceof Error ? e.message : String(e)}`;
}
