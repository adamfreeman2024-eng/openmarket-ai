import { z } from "zod";

export const AgentRegisterSchema = z.object({
  name: z.string().min(2).max(80),
  walletAccountId: z.string().regex(/^0\.0\.\d+$/),
  webhookUrl: z.string().url().optional(),
  capabilities: z.array(z.string().min(1).max(64)).min(1).max(32),
  homepage: z.string().url().optional(),
  policy: z
    .object({
      dailySpendLimit: z.number().positive().optional(),
      maxPerTx: z.number().positive().optional(),
      allowedCounterparties: z.array(z.string()).optional(),
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

export type AgentRecord = {
  id: string;
  apiKey: string;
  name: string;
  walletAccountId: string;
  webhookUrl?: string;
  capabilities: string[];
  homepage?: string;
  policy: {
    dailySpendLimit: number;
    maxPerTx: number;
    allowedCounterparties: string[];
    spentToday: number;
    spentDay: string; // YYYY-MM-DD UTC
  };
  stats: {
    sales: number;
    purchases: number;
    success: number;
    fail: number;
    totalLatencyMs: number;
  };
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
