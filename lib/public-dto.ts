/**
 * Public DTO helpers — never leak secrets in list/search APIs.
 */
import type { OfferRecord, AgentRecord } from "./types";

export function publicOffer(o: OfferRecord) {
  return {
    id: o.id,
    agentId: o.agentId,
    capability: o.capability,
    title: o.title,
    description: o.description,
    priceAmount: o.priceAmount,
    priceAsset: o.priceAsset,
    fulfillmentType: o.fulfillmentType,
    /** true if seller configured a webhook (URL never public) */
    webhookConfigured: Boolean(o.webhookUrl),
    maxSeconds: o.maxSeconds,
    escrow: o.escrow,
    tags: o.tags,
    active: o.active,
    createdAt: o.createdAt,
  };
}

export function publicAgent(a: AgentRecord) {
  return {
    id: a.id,
    name: a.name,
    walletAccountId: a.walletAccountId,
    capabilities: a.capabilities,
    homepage: a.homepage,
    webhookConfigured: Boolean(a.webhookUrl),
    policy: {
      dailySpendLimit: a.policy.dailySpendLimit,
      maxPerTx: a.policy.maxPerTx,
    },
    stats: a.stats,
    createdAt: a.createdAt,
  };
}
