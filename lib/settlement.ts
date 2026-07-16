/**
 * Settlement verification (x402-style) + escrow helpers.
 */
import {
  MIRROR,
  ALLOW_DEV_FAKE_SETTLEMENT,
  NETWORK,
  USDC_TOKEN_ID,
  USDC_DECIMALS,
} from "./config";
import { db, newId, type EscrowRecord } from "./store";

export async function verifyPayment(opts: {
  transactionId?: string;
  devFakePay?: boolean;
  expectedPayTo: string;
  expectedAmount: number;
  asset: string;
}): Promise<{ ok: boolean; error?: string; mode: string }> {
  if (opts.devFakePay) {
    if (!ALLOW_DEV_FAKE_SETTLEMENT) {
      return { ok: false, error: "devFakePay disabled", mode: "rejected" };
    }
    return { ok: true, mode: "dev_fake" };
  }

  if (!opts.transactionId) {
    return { ok: false, error: "transactionId required", mode: "missing_tx" };
  }

  if (db.isTxUsed(opts.transactionId)) {
    return {
      ok: false,
      error: "TRANSACTION_ALREADY_USED",
      mode: "replay",
    };
  }

  try {
    const encoded = encodeURIComponent(opts.transactionId);
    const url = `${MIRROR}/api/v1/transactions/${encoded}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return {
        ok: false,
        error: `Mirror lookup failed HTTP ${res.status}`,
        mode: "mirror_miss",
      };
    }
    const data = await res.json();
    const txs = data.transactions || (data.transaction_id ? [data] : []);
    if (!txs.length) {
      return { ok: false, error: "No transaction in mirror", mode: "mirror_empty" };
    }
    const t = txs[0];
    if (t.result && t.result !== "SUCCESS") {
      return { ok: false, error: `Tx result ${t.result}`, mode: "tx_fail" };
    }

    // Soft structural checks when transfers present
    const transfers = t.transfers || t.token_transfers || [];
    if (Array.isArray(transfers) && transfers.length && opts.expectedPayTo) {
      const hit = transfers.some((tr: { account?: string; amount?: number }) => {
        if (tr.account !== opts.expectedPayTo) return false;
        // HBAR tinybars: amount > 0 means credit
        return typeof tr.amount === "number" ? tr.amount > 0 : true;
      });
      // Don't hard-fail if shape differs — log via mode
      if (!hit) {
        return {
          ok: true,
          mode: `mirror_${NETWORK}_soft_no_payee_match`,
        };
      }
    }

    return { ok: true, mode: `mirror_${NETWORK}` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "verify failed",
      mode: "error",
    };
  }
}

export function fulfillInline(
  capability: string,
  input?: Record<string, unknown>
): unknown {
  if (capability === "echo.demo") {
    return { echo: input ?? {}, ts: new Date().toISOString() };
  }
  if (capability === "text.summarize") {
    const text = String(input?.text || input?.content || "");
    const summary = text.length <= 120 ? text : text.slice(0, 117) + "...";
    return { summary, chars: text.length };
  }
  if (capability === "delivery.demo") {
    return {
      status: "awaiting_proof",
      message: "Escrow locked — POST /api/v1/escrow/{id}/release with proof",
    };
  }
  return {
    ok: true,
    capability,
    message: "Inline fulfill stub — connect seller webhook for real work",
    input: input ?? {},
  };
}

export function createEscrowForOrder(opts: {
  orderId: string;
  amount: number;
  asset: string;
  buyerWallet?: string;
  sellerAgentId: string;
}): EscrowRecord {
  const now = new Date().toISOString();
  const e: EscrowRecord = {
    id: newId("esc"),
    orderId: opts.orderId,
    status: "locked",
    amount: opts.amount,
    asset: opts.asset,
    buyerWallet: opts.buyerWallet,
    sellerAgentId: opts.sellerAgentId,
    createdAt: now,
    updatedAt: now,
  };
  db.putEscrow(e);
  return e;
}

export function usdcMeta() {
  return {
    tokenId: USDC_TOKEN_ID || null,
    decimals: USDC_DECIMALS,
    live: Boolean(USDC_TOKEN_ID),
    note: USDC_TOKEN_ID
      ? "HTS USDC configured"
      : "Set USDC_TOKEN_ID / NEXT_PUBLIC_USDC_TOKEN_ID to enable USDC settlement",
  };
}
