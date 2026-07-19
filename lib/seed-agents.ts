/**
 * Seed service agents — built-in LLM-powered agents that ensure the
 * marketplace is never empty. New agents can buy services immediately.
 *
 * Each seed agent has:
 * - A dedicated agent record with API key
 * - One or more offers at low prices
 * - LLM-backed fulfillment (already wired via lib/llm.ts)
 *
 * Run on startup via ensureSeedCatalog() → ensureSeedAgents()
 */
import { db, newId, utcDay, audit } from "./store";
import type { AgentRecord, OfferRecord } from "./types";

export type SeedAgentDef = {
  id: string; // stable ID so we don't duplicate on restart
  name: string;
  walletAccountId: string;
  capabilities: string[];
  offers: Array<{
    capability: string;
    title: string;
    description: string;
    priceAmount: number;
    priceAsset: "HBAR";
    fulfillmentType: "llm" | "inline";
    maxSeconds: number;
    tags: string[];
  }>;
};

/** 6 seed service agents covering all LLM capabilities */
export const SEED_AGENTS: SeedAgentDef[] = [
  {
    id: "agt_seed_translator",
    name: "OM Translator",
    walletAccountId: "0.0.2001",
    capabilities: ["text.translate"],
    offers: [
      {
        capability: "text.translate",
        title: "Professional Translation Service",
        description:
          "Translate text to any language. Supports 100+ languages. Powered by LLM. Input: {text, targetLang}. Returns: {translation, targetLang}.",
        priceAmount: 0.01,
        priceAsset: "HBAR",
        fulfillmentType: "llm",
        maxSeconds: 30,
        tags: ["translation", "nlp", "llm", "popular"],
      },
    ],
  },
  {
    id: "agt_seed_summarizer",
    name: "OM Summarizer",
    walletAccountId: "0.0.2002",
    capabilities: ["text.summarize"],
    offers: [
      {
        capability: "text.summarize",
        title: "Text Summarization Service",
        description:
          "Concise summary of any text. Good for articles, emails, documents. Input: {text}. Returns: {summary, chars}.",
        priceAmount: 0.01,
        priceAsset: "HBAR",
        fulfillmentType: "llm",
        maxSeconds: 30,
        tags: ["summarization", "nlp", "llm", "popular"],
      },
    ],
  },
  {
    id: "agt_seed_reviewer",
    name: "OM Code Reviewer",
    walletAccountId: "0.0.2003",
    capabilities: ["code.review"],
    offers: [
      {
        capability: "code.review",
        title: "Code Review Service",
        description:
          "Senior code reviewer. Finds bugs, security issues, performance problems. Input: {code}. Returns: {review} with CRITICAL/HIGH/MEDIUM/LOW severity.",
        priceAmount: 0.05,
        priceAsset: "HBAR",
        fulfillmentType: "llm",
        maxSeconds: 60,
        tags: ["code-review", "security", "llm"],
      },
    ],
  },
  {
    id: "agt_seed_sentiment",
    name: "OM Sentiment",
    walletAccountId: "0.0.2004",
    capabilities: ["text.sentiment"],
    offers: [
      {
        capability: "text.sentiment",
        title: "Sentiment Analysis Service",
        description:
          "Analyze sentiment: positive, negative, or neutral. Input: {text}. Returns: {sentiment, confidence, summary} JSON.",
        priceAmount: 0.01,
        priceAsset: "HBAR",
        fulfillmentType: "llm",
        maxSeconds: 15,
        tags: ["sentiment", "nlp", "llm"],
      },
    ],
  },
  {
    id: "agt_seed_classifier",
    name: "OM Classifier",
    walletAccountId: "0.0.2005",
    capabilities: ["text.classify"],
    offers: [
      {
        capability: "text.classify",
        title: "Text Classification Service",
        description:
          "Classify text into categories. Input: {text, categories}. Returns: {category, confidence} JSON.",
        priceAmount: 0.01,
        priceAsset: "HBAR",
        fulfillmentType: "llm",
        maxSeconds: 15,
        tags: ["classification", "nlp", "llm"],
      },
    ],
  },
  {
    id: "agt_seed_extractor",
    name: "OM Extractor",
    walletAccountId: "0.0.2006",
    capabilities: ["text.extract"],
    offers: [
      {
        capability: "text.extract",
        title: "Information Extraction Service",
        description:
          "Extract structured data from text. Input: {text, fields}. Returns: JSON with extracted fields.",
        priceAmount: 0.02,
        priceAsset: "HBAR",
        fulfillmentType: "llm",
        maxSeconds: 30,
        tags: ["extraction", "nlp", "llm"],
      },
    ],
  },
];

/** Stable API keys for seed agents (so they persist across restarts) */
const SEED_API_KEYS: Record<string, string> = {
  agt_seed_translator: "omk_seed_translator_v1",
  agt_seed_summarizer: "omk_seed_summarizer_v1",
  agt_seed_reviewer: "omk_seed_reviewer_v1",
  agt_seed_sentiment: "omk_seed_sentiment_v1",
  agt_seed_classifier: "omk_seed_classifier_v1",
  agt_seed_extractor: "omk_seed_extractor_v1",
};

/**
 * Ensure all 6 seed service agents exist with their offers.
 * Idempotent — safe to call on every startup.
 * Does NOT duplicate existing agents/offers.
 */
export function ensureSeedAgents(): void {
  let created = 0;

  for (const def of SEED_AGENTS) {
    // Check if agent already exists
    const existing = db.getAgent(def.id);
    if (existing) {
      // Ensure all offers exist for this agent
      for (const offerDef of def.offers) {
        const existingOffers = db.listOffers();
        const hasCap = existingOffers.some(
          (o) => o.capability === offerDef.capability && o.agentId === def.id && o.active
        );
        if (!hasCap) {
          createSeedOffer(def.id, offerDef);
          created++;
        }
      }
      continue;
    }

    // Create new seed agent
    const agent: AgentRecord = {
      id: def.id,
      apiKey: SEED_API_KEYS[def.id] || `omk_seed_${def.id}`,
      name: def.name,
      walletAccountId: def.walletAccountId,
      capabilities: def.capabilities,
      policy: {
        dailySpendLimit: 1000,
        maxPerTx: 100,
        allowedCounterparties: [],
        spentToday: 0,
        spentDay: utcDay(),
      },
      stats: {
        sales: 0,
        purchases: 0,
        success: 0,
        fail: 0,
        totalLatencyMs: 0,
      },
      createdAt: new Date().toISOString(),
    };
    db.putAgent(agent);

    // Create offers for this agent
    for (const offerDef of def.offers) {
      createSeedOffer(def.id, offerDef);
      created++;
    }

    audit("seed.agent_created", { agentId: def.id, name: def.name });
  }

  if (created > 0) {
    audit("seed.agents_ensured", { created, total: SEED_AGENTS.length });
  }
}

function createSeedOffer(
  agentId: string,
  offerDef: SeedAgentDef["offers"][0]
): void {
  const offer: OfferRecord = {
    id: newId("off"),
    agentId,
    capability: offerDef.capability,
    title: offerDef.title,
    description: offerDef.description,
    priceAmount: offerDef.priceAmount,
    priceAsset: offerDef.priceAsset,
    fulfillmentType: offerDef.fulfillmentType,
    maxSeconds: offerDef.maxSeconds,
    escrow: false,
    tags: offerDef.tags,
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.putOffer(offer);
}

/** List all seed agent IDs (for admin/debug) */
export function listSeedAgentIds(): string[] {
  return SEED_AGENTS.map((a) => a.id);
}

/** Check if an agent is a seed agent */
export function isSeedAgent(agentId: string): boolean {
  return SEED_AGENTS.some((a) => a.id === agentId);
}
