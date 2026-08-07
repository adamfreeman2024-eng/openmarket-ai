import { z } from "zod";

export const AgentRegisterSchema = z.object({
  name: z.string().min(2).max(80),
  walletAccountId: z.string().regex(/^0\.0\.\d+$/),
  webhookUrl: z.string().url().optional(),
  capabilities: z.array(z.string().min(1).max(64)).min(1).max(32),
  homepage: z.string().url().optional(),
  /** Telegram chat id for order/escrow notifications (e.g. "429384890") */
  telegramChatId: z.string().min(1).max(64).optional(),
  /** Email for order/escrow notifications */
  email: z.string().email().optional(),
  policy: z
    .object({
      dailySpendLimit: z.number().positive().optional(),
      maxPerTx: z.number().positive().optional(),
      allowedCounterparties: z.array(z.string()).optional(),
      allowedHours: z.array(z.tuple([z.string(), z.string()])).optional(), // ["HH:MM","HH:MM"] UTC windows
      velocityPerMinute: z.number().nonnegative().optional(), // max tx per minute (0 = unlimited)
    })
    .optional(),
});

export const OfferCreateSchema = z.object({
  capability: z.string().min(1).max(64),
  title: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  priceAmount: z.number().positive(),
  priceAsset: z.enum(["HBAR", "USDC"]).default("HBAR"),
  fulfillmentType: z.enum(["webhook", "inline", "manual", "llm"]).default("inline"),
  webhookUrl: z.string().url().optional(),
  maxSeconds: z.number().int().positive().max(3600).default(60),
  escrow: z.boolean().default(false),
  tags: z.array(z.string()).max(16).optional(),
});

export const QuoteRequestSchema = z.object({
  offerId: z.string().min(4),
  buyerAgentId: z.string().min(4).optional(),
  buyerWallet: z.string().regex(/^0\.0\.\d+$/).optional(),
  input: z.record(z.unknown()).optional(),
});

export const OrderCreateSchema = z.object({
  quoteId: z.string().min(4),
  buyerAgentId: z.string().min(4).optional(),
  buyerWallet: z.string().regex(/^0\.0\.\d+$/).optional(),
});

export const OrderPaySchema = z.object({
  transactionId: z.string().min(8).optional(),
  /** Dev only when ALLOW_DEV_FAKE_SETTLEMENT=true */
  devFakePay: z.boolean().optional(),
});

export type VerificationStatus = "bronze" | "silver" | "gold";

/** Persisted multi-channel notification for an agent (webhook/telegram/email + inbox). */
export type NotificationRecord = {
  id: string;
  agentId: string;
  event:
    | "order_created"
    | "order_completed"
    | "order_failed"
    | "payment_received"
    | "escrow_locked"
    | "escrow_released"
    | "escrow_refunded"
    | "dispute_opened"
    | "dispute_resolved"
    | "review_received";
  title: string;
  message: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: string;
};

/** Durable record of one outbound webhook delivery attempt (retry-aware). */
export type WebhookDeliveryLog = {
  id: string;
  agentId: string;
  event: string;
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
  attempts: number;
  durationMs: number;
  createdAt: string;
  /** Exact payload sent on the last attempt — enables identical retry. */
  payload?: Record<string, unknown>;
};

export type AgentRecord = {
  id: string;
  apiKey: string;
  name: string;
  walletAccountId: string;
  webhookUrl?: string;
  capabilities: string[];
  homepage?: string;
  /** Telegram chat id for notifications (order completed, escrow release, disputes) */
  telegramChatId?: string;
  /** Email for notifications */
  email?: string;
  policy: {
    dailySpendLimit: number;
    maxPerTx: number;
    allowedCounterparties: string[];
    allowedHours: [string, string][]; // ["HH:MM","HH:MM"] UTC windows
    velocityPerMinute: number; // max tx per minute (0 = unlimited)
    spentToday: number;
    spentDay: string; // YYYY-MM-DD UTC
    spentAt: number[]; // recent tx timestamps (epoch ms) for velocity window
  };
  stats: {
    sales: number;
    purchases: number;
    success: number;
    fail: number;
    totalLatencyMs: number;
  };
  /** Trust tier: bronze=registered, silver=GitHub verified, gold=code audited */
  verificationStatus?: VerificationStatus;
  /** Public GitHub username after/during Silver verification */
  githubHandle?: string;
  /** One-time token for Gist ownership proof; cleared after verify */
  githubVerificationToken?: string | null;
  /** Public repo submitted for Gold audit */
  auditRepositoryUrl?: string;
  /** Last Gold audit result summary */
  lastAuditSummary?: string;
  lastAuditAt?: string;
  /** Last Gold audit score (0-100) and tier */
  lastAuditScore?: number;
  lastAuditTier?: string;
  /**
   * Platform ledger balance (A2A credits) in price-asset units.
   * Credited on successful sales; spent when hiring other agents via /hire.
   */
  internalBalance?: number;
  /** Auto-payout destination preference (Task 6.3). Optional — sellers
   *  without these fields are skipped by schedulePayouts(). */
  payoutMethod?: "hbar" | "usdc" | "manual";
  payoutAccount?: string;
  createdAt: string;
};

export type OfferRecord = {
  id: string;
  agentId: string;
  capability: string;
  title: string;
  description?: string;
  priceAmount: number;
  priceAsset: "HBAR" | "USDC";
  fulfillmentType: "webhook" | "inline" | "manual" | "llm";
  webhookUrl?: string;
  maxSeconds: number;
  escrow: boolean;
  tags: string[];
  active: boolean;
  createdAt: string;
  boostedUntil?: string; // ISO date — paid visibility boost
};

export type QuoteRecord = {
  id: string;
  offerId: string;
  agentId: string;
  buyerAgentId?: string;
  buyerWallet?: string;
  priceAmount: number;
  platformFee: number;
  totalAmount: number;
  priceAsset: "HBAR" | "USDC";
  payTo: string;
  expiresAt: string;
  input?: Record<string, unknown>;
  createdAt: string;
};

export type OrderStatus =
  | "awaiting_payment"
  | "paid"
  | "fulfilling"
  | "completed"
  | "failed"
  | "refunded";

export type OrderRecord = {
  id: string;
  quoteId: string;
  offerId: string;
  sellerAgentId: string;
  buyerAgentId?: string;
  buyerWallet?: string;
  totalAmount: number;
  platformFee: number;
  /** Seller net after platform fee (total − fee) — set on completion. */
  sellerAmount?: number;
  priceAsset: "HBAR" | "USDC";
  status: OrderStatus;
  transactionId?: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  completedAt?: string;
  latencyMs?: number;
};

export type AuditEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  at: string;
};
