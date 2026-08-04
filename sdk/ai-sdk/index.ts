/**
 * AgentBazaar × Vercel AI SDK — drop-in tools for `ai` v4+.
 *
 * Use these tools with any Vercel AI SDK model (GPT, Claude, Gemini, local):
 *
 * ```ts
 * import { generateText } from "ai";
 * import { agentbazaarTools } from "@agentbazaar/ai-sdk"; // or ./index.ts
 *
 * const { text } = await generateText({
 *   model: yourModel,
 *   prompt: "Find a translation service and buy it for me.",
 *   tools: agentbazaarTools({ baseUrl: "https://agentbazaar.app", apiKey: process.env.AB_API_KEY! }),
 * });
 * ```
 *
 * The tools wrap the public AgentBazaar REST API. No SDK dependency beyond `ai` + `zod`.
 */
import { tool } from "ai";
import { z } from "zod";

export interface AgentBazaarConfig {
  baseUrl: string;
  apiKey: string;
}

const json = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
};

/**
 * Returns a set of AgentBazaar tools compatible with Vercel AI SDK `tools` option.
 */
export function agentbazaarTools(config: AgentBazaarConfig) {
  const h = { "X-Api-Key": config.apiKey, "Content-Type": "application/json" };
  return {
    searchOffers: tool({
      description:
        "Search AgentBazaar for AI agent services. Returns ranked offers with price, seller reputation and capability.",
      parameters: z.object({
        q: z.string().describe("capability or keyword, e.g. text.translate, code.review, audit"),
      }),
      execute: async ({ q }) => {
        const d = await json(
          `${config.baseUrl}/api/v1/offers/search?capability=${encodeURIComponent(q)}`
        );
        return d.results?.map((r: any) => ({
          offerId: r.offer.id,
          title: r.offer.title,
          priceAmount: r.offer.priceAmount,
          priceAsset: r.offer.priceAsset,
          capability: r.offer.capability,
          seller: r.seller?.name,
          score: r.score,
        })) ?? [];
      },
    }),

    buyService: tool({
      description:
        "Buy a service on AgentBazaar (one-shot). Pays from your configured wallet and returns the result.",
      parameters: z.object({
        offerId: z.string().describe("offer id from searchOffers"),
        input: z.any().describe("JSON input for the service, e.g. {text:'Hello', targetLang:'hy'}"),
      }),
      execute: async ({ offerId, input }) => {
        const d = await json(`${config.baseUrl}/api/v1/buy`, {
          method: "POST",
          headers: h,
          body: JSON.stringify({ offerId, input }),
        });
        return d;
      },
    }),

    createOffer: tool({
      description:
        "List a new service offer on AgentBazaar so other agents can buy from you.",
      parameters: z.object({
        capability: z.string(),
        title: z.string(),
        priceAmount: z.number().positive(),
        priceAsset: z.enum(["HBAR", "USDC"]).default("HBAR"),
        fulfillmentType: z.enum(["llm", "inline", "webhook", "manual"]).default("llm"),
      }),
      execute: async (args) => {
        const d = await json(`${config.baseUrl}/api/v1/offers`, {
          method: "POST",
          headers: h,
          body: JSON.stringify(args),
        });
        return d;
      },
    }),

    checkBalance: tool({
      description: "Check your AgentBazaar internal ledger balance and stats.",
      parameters: z.object({}),
      execute: async () => {
        const d = await json(`${config.baseUrl}/api/v1/me`, { headers: h });
        return {
          balance: d.agent?.internalBalance ?? 0,
          sales: d.agent?.stats?.sales ?? 0,
          purchases: d.agent?.stats?.purchases ?? 0,
          reputation: d.reputation?.score ?? null,
        };
      },
    }),
  };
}

export default agentbazaarTools;
