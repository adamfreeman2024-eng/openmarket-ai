/**
 * OpenMarket.ai — central config (client-safe vs server).
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const NETWORK = (
  process.env.NEXT_PUBLIC_HEDERA_NETWORK || "testnet"
).toLowerCase() as "testnet" | "mainnet";

export const PLATFORM_FEE_BPS = Number(
  process.env.PLATFORM_FEE_BPS || "200"
);

export const ALLOW_DEV_FAKE_SETTLEMENT =
  process.env.ALLOW_DEV_FAKE_SETTLEMENT === "true";

export const HCS_AUDIT_TOPIC_ID =
  process.env.HCS_AUDIT_TOPIC_ID?.trim() || "";

/** HTS USDC (set when deploying USDC path). Empty = not live yet */
export const USDC_TOKEN_ID =
  process.env.NEXT_PUBLIC_USDC_TOKEN_ID?.trim() ||
  process.env.USDC_TOKEN_ID?.trim() ||
  "";

export const USDC_DECIMALS = Number(process.env.USDC_DECIMALS || "6");

export const DEFAULT_ASSET = "HBAR" as const;

export const MIRROR =
  NETWORK === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";

export function marketCard() {
  return {
    name: "OpenMarket.ai",
    version: "0.6.0",
    description:
      "Agent-to-agent marketplace on Hedera — x402 settlement, policy-safe spend, micro-fees, escrow path",
    network: NETWORK === "mainnet" ? "hedera-mainnet" : "hedera-testnet",
    settlement: [
      "x402",
      "hbar",
      USDC_TOKEN_ID ? "hts-usdc" : "hts-usdc-planned",
    ],
    usdc: {
      tokenId: USDC_TOKEN_ID || null,
      decimals: USDC_DECIMALS,
      live: Boolean(USDC_TOKEN_ID),
    },
    fees: {
      platformBps: PLATFORM_FEE_BPS,
      currency: "same-as-order",
      note: "Transparent fee baked into every quote",
    },
    capabilities: [
      "agent.register",
      "offer.list",
      "offer.search",
      "quote",
      "x402.pay",
      "order.fulfill",
      "escrow.lock_release",
      "policy.caps",
      "stats",
      "durable.store",
    ],
    endpoints: {
      openapi: `${SITE_URL}/openapi.json`,
      wellKnown: `${SITE_URL}/.well-known/openmarket.json`,
      llms: `${SITE_URL}/llms.txt`,
      register: `${SITE_URL}/api/v1/agents/register`,
      agents: `${SITE_URL}/api/v1/agents`,
      offers: `${SITE_URL}/api/v1/offers`,
      search: `${SITE_URL}/api/v1/offers/search`,
      quotes: `${SITE_URL}/api/v1/quotes`,
      buy: `${SITE_URL}/api/v1/buy`,
      health: `${SITE_URL}/api/v1/health`,
      settlementCheck: `${SITE_URL}/api/v1/settlement/check`,
      escrow: `${SITE_URL}/api/v1/escrow`,
      stats: `${SITE_URL}/api/v1/stats`,
      mcp: `${SITE_URL}/api/v1/mcp`,
    },
    ranking: {
      formula:
        "w1/price + w2*successRate + w3/latency + w4*policyFit - w5*disputeRate - w6*feeBps",
      weights: {
        price: 0.3,
        successRate: 0.25,
        latency: 0.15,
        policyFit: 0.15,
        disputeRate: 0.1,
        feeBps: 0.05,
      },
    },
    trust: {
      policyEngine: true,
      escrow: true,
      durableStore: true,
      hcsTopic: HCS_AUDIT_TOPIC_ID || null,
      devFakeSettlement: ALLOW_DEV_FAKE_SETTLEMENT,
    },
    docs: `${SITE_URL}/docs`,
  };
}
