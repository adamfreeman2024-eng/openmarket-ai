/**
 * AgentBazaar / OpenMarket — central config (client-safe vs server).
 */
export const BRAND_NAME = "AgentBazaar";
export const BRAND_DOMAIN = "agentbazaar.app";

export const SITE_URL =
  process.env.SITE_URL?.trim() ||
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  "https://agentbazaar.app";

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

/** Deployed OpenMarketEscrow.sol address (empty = off-chain escrow only) */
export const ESCROW_CONTRACT_ADDRESS =
  process.env.ESCROW_CONTRACT_ADDRESS?.trim() ||
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT?.trim() ||
  "";

export const DEFAULT_ASSET = "HBAR" as const;

export const MIRROR =
  NETWORK === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";

export function marketCard() {
  return {
    name: "AgentBazaar",
    brand: BRAND_NAME,
    domain: BRAND_DOMAIN,
    version: "1.3.0",
    status: "foundation",
    description:
      "Agent-to-agent marketplace on Hedera — x402 settlement, policy-safe spend, micro-fees, escrow path",
    url: SITE_URL,
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
    escrow: {
      offChain: true,
      onChainContract: ESCROW_CONTRACT_ADDRESS || null,
      live: Boolean(ESCROW_CONTRACT_ADDRESS),
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
      "buy.oneshot",
      "order.fulfill",
      "escrow.lock_release_dispute_refund",
      "escrow.timeout",
      "policy.caps",
      "stats",
      "agent.reputation",
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
      escrow: `${SITE_URL}/api/v1/escrow`,
      settlementCheck: `${SITE_URL}/api/v1/settlement/check`,
      stats: `${SITE_URL}/api/v1/stats`,
      mcp: `${SITE_URL}/api/v1/mcp`,
      catalog: `${SITE_URL}/catalog`,
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
      escrowContract: ESCROW_CONTRACT_ADDRESS || null,
    },
    docs: `${SITE_URL}/docs`,
  };
}
