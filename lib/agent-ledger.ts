/**
 * Platform internal ledger for agent-to-agent (A2A) commerce.
 * Credits sellers on successful sales; debits hirers on /hire.
 *
 * creditSale is IDEMPOTENT per orderId (claimTxUsed-style) so release /
 * pay / dispute-keep double paths cannot double-pay the seller.
 */
import type { AgentRecord } from "./types";
import { db } from "./store";

export function getBalance(agent: AgentRecord): number {
  return Number(agent.internalBalance ?? 0);
}

export function creditAgent(
  agentId: string,
  amount: number,
  reason: string
): AgentRecord | null {
  if (!(amount > 0)) return db.getAgent(agentId) || null;
  const a = db.getAgent(agentId);
  if (!a) return null;
  const next = {
    ...a,
    internalBalance: Number((getBalance(a) + amount).toFixed(8)),
  };
  db.putAgent(next);
  try {
    const { audit } = require("./store") as typeof import("./store");
    audit("ledger.credit", { agentId, amount, reason, balance: next.internalBalance });
  } catch {
    /* ignore */
  }
  return next;
}

export function debitAgent(
  agentId: string,
  amount: number,
  reason: string
): { ok: true; agent: AgentRecord } | { ok: false; error: string } {
  if (!(amount > 0)) return { ok: false, error: "Invalid debit amount" };
  const a = db.getAgent(agentId);
  if (!a) return { ok: false, error: "Agent not found" };
  const bal = getBalance(a);
  if (bal + 1e-12 < amount) {
    return {
      ok: false,
      error: `INSUFFICIENT_BALANCE: have ${bal}, need ${amount}`,
    };
  }
  const next = {
    ...a,
    internalBalance: Number((bal - amount).toFixed(8)),
  };
  db.putAgent(next);
  try {
    const { audit } = require("./store") as typeof import("./store");
    audit("ledger.debit", { agentId, amount, reason, balance: next.internalBalance });
  } catch {
    /* ignore */
  }
  return { ok: true, agent: next };
}

/**
 * Seller net after platform fee already split at order level — credit priceAmount.
 * Idempotent: second call with the same orderId is a no-op (returns current agent).
 */
export function creditSale(sellerAgentId: string, priceAmount: number, orderId: string) {
  const claimKey = `sale:${orderId}`;
  // Reuse usedTx set for durable claim keys (persisted with the store).
  if (!db.claimTxUsed(claimKey)) {
    return db.getAgent(sellerAgentId) || null;
  }
  return creditAgent(sellerAgentId, priceAmount, claimKey);
}

/**
 * Reverse a prior sale credit (dispute refund after release / operator clawback).
 * Idempotent via claim key `sale-reverse:{orderId}`. Only debits if the original
 * sale claim exists; clamps debit to available balance.
 */
export function reverseSaleCredit(
  sellerAgentId: string,
  priceAmount: number,
  orderId: string
): AgentRecord | null {
  if (!(priceAmount > 0)) return db.getAgent(sellerAgentId) || null;
  const saleKey = `sale:${orderId}`;
  const reverseKey = `sale-reverse:${orderId}`;
  if (!db.isTxUsed(saleKey)) {
    return db.getAgent(sellerAgentId) || null;
  }
  if (!db.claimTxUsed(reverseKey)) {
    return db.getAgent(sellerAgentId) || null;
  }
  const a = db.getAgent(sellerAgentId);
  if (!a) return null;
  const bal = getBalance(a);
  const debit = Math.min(bal, priceAmount);
  if (!(debit > 0)) return a;
  const next = {
    ...a,
    internalBalance: Number((bal - debit).toFixed(8)),
  };
  db.putAgent(next);
  try {
    const { audit } = require("./store") as typeof import("./store");
    audit("ledger.debit", {
      agentId: sellerAgentId,
      amount: debit,
      reason: reverseKey,
      balance: next.internalBalance,
    });
  } catch {
    /* ignore */
  }
  return next;
}
