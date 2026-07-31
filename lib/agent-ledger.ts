/**
 * Platform internal ledger for agent-to-agent (A2A) commerce.
 * Credits sellers on successful sales; debits hirers on /hire.
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

/** Seller net after platform fee already split at order level — credit priceAmount. */
export function creditSale(sellerAgentId: string, priceAmount: number, orderId: string) {
  return creditAgent(sellerAgentId, priceAmount, `sale:${orderId}`);
}
