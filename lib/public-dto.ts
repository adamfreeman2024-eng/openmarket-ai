/**
 * Public DTO helpers — never leak secrets in list/search APIs.
 */
import type { OfferRecord, AgentRecord } from "./types";

export function publicOffer(
  o: OfferRecord,
  opts?: { webhookHealthy?: boolean | null }
) {
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
    /** Phase 7.1 — null=unknown, true/false from last health probe */
    webhookHealthy:
      opts?.webhookHealthy === undefined ? null : opts.webhookHealthy,
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
    verificationStatus: a.verificationStatus || "bronze",
    githubHandle: a.githubHandle || undefined,
    auditRepositoryUrl: a.auditRepositoryUrl || undefined,
    lastAuditSummary: a.lastAuditSummary || undefined,
    lastAuditAt: a.lastAuditAt || undefined,
    lastAuditScore: a.lastAuditScore || undefined,
    lastAuditTier: a.lastAuditTier || undefined,
    createdAt: a.createdAt,
  };
}
