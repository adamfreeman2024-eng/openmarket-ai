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
  createdAt: string;
  updatedAt: string;
};
