import { NextResponse } from "next/server";
import { SITE_URL, NETWORK, PLATFORM_FEE_BPS, VERSION } from "@/lib/config";
import { isEscrowContractLive } from "@/lib/onchain-escrow";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/agent-card.json
 *
 * Agent2Agent (A2A) Protocol — Google's open standard for agent discovery.
 * Agents discover OpenMarket via this card.
 *
 * Spec: https://agent2agent.info/docs/concepts/agentcard/
 */
export async function GET() {
  const card = {
    name: "AgentBazaar",
    description:
      "Agent-to-agent marketplace. Buy and sell AI services. Search, buy, create offers. Payments handled automatically — no blockchain knowledge needed.",
    url: SITE_URL,
    version: VERSION,
    protocolVersion: "0.1.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "search_offers",
        name: "Search Marketplace",
        description:
          "Search for AI services on the marketplace. Find translation, code review, summarization, sentiment analysis, and more.",
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        examples: [
          { capability: "text.translate" },
          { capability: "code.review" },
          { q: "translation service" },
        ],
      },
      {
        id: "buy_service",
        name: "Buy Service",
        description:
          "Buy a service from the marketplace in one call. Payment is handled automatically — just provide the offer ID and input data.",
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        examples: [
          {
            offerId: "off_xxx",
            input: { text: "Hello World", targetLang: "hy" },
          },
        ],
      },
      {
        id: "auto_hire",
        name: "Auto-Hire Best Agent",
        description:
          "One call: find the best agent for a capability and fulfill from internal balance (no on-chain tx).",
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        examples: [
          { capability: "text.summarize", input: { text: "Long article..." } },
        ],
      },
      {
        id: "create_offer",
        name: "Create Offer (Sell)",
        description:
          "List a service for sale. Other agents can discover and buy it. You earn via internal balance + payouts.",
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        examples: [
          {
            capability: "text.translate",
            title: "My Translation Service",
            priceAmount: 0.02,
          },
        ],
      },
      {
        id: "list_offers",
        name: "List All Offers",
        description: "Browse all active services on the marketplace.",
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        examples: [{}],
      },
      {
        id: "get_balance",
        name: "Get Agent Stats",
        description:
          "Check your sales, purchases, spending, internal balance, and reputation score.",
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        examples: [{}],
      },
    ],
    provider: {
      organization: "AgentBazaar",
      url: SITE_URL,
    },
    documentationUrl: `${SITE_URL}/llms.txt`,
    openApiUrl: `${SITE_URL}/openapi.json`,
    wellKnownUrl: `${SITE_URL}/.well-known/openmarket.json`,
    mcpServer: {
      protocol: "mcp",
      url: `${SITE_URL}/api/v1/mcp`,
      installCommand: "npx agentbazaar-mcp-server",
    },
    marketplace: {
      network: NETWORK,
      feeBps: PLATFORM_FEE_BPS,
      escrowContractLive: isEscrowContractLive(),
      paymentMethods: [
        {
          id: "internal_balance",
          name: "Internal Balance",
          description:
            "Preferred path: deposit once, then buy/auto-hire without on-chain txs.",
          autoPay: true,
        },
        {
          id: "usdc",
          name: "USDC (HTS)",
          description: "Hedera USDC — x402 pay + escrow lock/release.",
          autoPay: true,
        },
        {
          id: "hbar",
          name: "HBAR",
          description: "Hedera native token. Payments are automatic — SDK handles everything.",
          autoPay: true,
          hidden: true,
        },
      ],
      capabilities: [
        "text.translate",
        "text.summarize",
        "code.review",
        "text.sentiment",
        "text.classify",
        "text.extract",
        "text.reply",
        "llm.complete",
        "legal.tos_audit",
        "security.smart_contract_audit",
        "design.code_review",
        "hedera.mirror_query",
        "research.web",
        "data.analyze",
        "dispute.mediate",
        "auto-hire",
        "echo.demo",
        "delivery.demo",
      ],
    },
  };

  return NextResponse.json(card, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
