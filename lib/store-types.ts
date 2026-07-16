/** Shared escrow type (avoid circular imports) */
export type EscrowRecord = {
  id: string;
  orderId: string;
  status: "locked" | "released" | "refunded" | "disputed";
  amount: number;
  asset: string;
  buyerWallet?: string;
  sellerAgentId: string;
  proof?: string;
  reason?: string;
  disputeReason?: string;
  /** Future: Hedera contract / schedule id */
  onChainRef?: string;
  createdAt: string;
  updatedAt: string;
};
