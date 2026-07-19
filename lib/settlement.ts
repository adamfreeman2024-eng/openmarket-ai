/**
 * Settlement verification (x402-style) — HBAR + HTS USDC via Mirror Node.
 * Strict mode when STRICT_SETTLEMENT=true or production (devFake off).
 */
import {
  MIRROR,
  ALLOW_DEV_FAKE_SETTLEMENT,
  NETWORK,
  USDC_TOKEN_ID,
  USDC_DECIMALS,
} from "./config";
import { db, newId, type EscrowRecord } from "./store";
import { toBaseUnits } from "./assets";
import { normalizeTxId } from "./tx-id";

export { normalizeTxId } from "./tx-id";

export const STRICT_SETTLEMENT =
  process.env.STRICT_SETTLEMENT === "true" ||
  process.env.STRICT_SETTLEMENT === "1" ||
  (!ALLOW_DEV_FAKE_SETTLEMENT && process.env.STRICT_SETTLEMENT !== "false");

type Transfer = { account?: string; amount?: number; token_id?: string };

function creditToPayee(
  transfers: Transfer[],
  payTo: string,
  minBase: number
): { ok: boolean; credited: number; reason?: string } {
  let credited = 0;
  for (const tr of transfers) {
    if (tr.account === payTo && typeof tr.amount === "number" && tr.amount > 0) {
      credited += tr.amount;
    }
  }
  if (credited <= 0) {
    return { ok: false, credited: 0, reason: "NO_CREDIT_TO_PAYEE" };
  }
  // Allow 1 base unit tolerance for rounding
  if (credited + 1 < minBase) {
    return {
      ok: false,
      credited,
      reason: `AMOUNT_LOW expected>=${minBase} got=${credited}`,
    };
  }
  return { ok: true, credited };
}

function collectHbarCredits(tx: Record<string, unknown>): Transfer[] {
  const list: Transfer[] = [];
  
  // Shape A: Direct transfers array (common format)
  if (Array.isArray(tx.transfers)) {
    for (const tr of tx.transfers as Transfer[]) {
      list.push(tr);
    }
  }
  
  // Shape B: transaction_transfers (alternate Hedera Mirror API version)
  if (Array.isArray(tx.transaction_transfers)) {
    for (const tr of tx.transaction_transfers as Transfer[]) {
      list.push(tr);
    }
  }
  
  // Shape C: token_transfers with nested account info (rare case)
  if (Array.isArray(tx.token_transfers)) {
    const tokenTransfers = tx.token_transfers as Array<{ transfers?: Transfer[] }>;
    for (const tt of tokenTransfers) {
      if (Array.isArray(tt.transfers)) {
        for (const tr of tt.transfers as Transfer[]) {
          list.push(tr);
        }
      }
    }
  }
  
  return list;
}

function collectTokenCredits(
  tx: Record<string, unknown>,
  tokenId: string
): Transfer[] {
  const out: Transfer[] = [];
  
  // Shape A: Flat token_transfers [{token_id, account, amount}]
  const flatTransfers = (tx.token_transfers as Transfer[]) || [];
  if (Array.isArray(flatTransfers)) {
    for (const tr of flatTransfers) {
      if (tr.token_id === tokenId) out.push(tr);
    }
  }
  
  // Shape B: Nested format - tokens[].transfers
  const nestedTokens = (tx.tokens as Array<{ token_id?: string; transfers?: Transfer[] }> | undefined) || [];
  if (Array.isArray(nestedTokens)) {
    for (const t of nestedTokens) {
      if (t.token_id === tokenId && Array.isArray(t.transfers)) {
        for (const tr of t.transfers) out.push({ ...tr, token_id: tokenId });
      }
    }
  }
  
  // Shape C: Alternate format - transactions[].token_transfers[].transfers
  const transactions = (tx.transactions as Array<{ token_transfers?: Array<{ transfers?: Transfer[] }> }> | undefined) || [];
  if (Array.isArray(transactions)) {
    for (const txn of transactions) {
      const tokenTransfers = txn.token_transfers || [];
      if (Array.isArray(tokenTransfers)) {
        for (const tt of tokenTransfers) {
          if (tt.transfers && Array.isArray(tt.transfers)) {
            for (const tr of tt.transfers) out.push({ ...tr, token_id: tokenId });
          }
        }
      }
    }
  }
  
  return out;
}

export async function fetchMirrorTransaction(
  transactionId: string
): Promise<{ ok: boolean; tx?: Record<string, unknown>; error?: string }> {
  const id = normalizeTxId(transactionId);
  const url = `${MIRROR}/api/v1/transactions/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, error: `Mirror HTTP ${res.status}` };
    }
    const data = await res.json();
    const txs = data.transactions || (data.transaction_id ? [data] : []);
    if (!txs.length) return { ok: false, error: "No transaction in mirror" };
    return { ok: true, tx: txs[0] as Record<string, unknown> };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "mirror fetch failed",
    };
  }
}

export async function verifyPayment(opts: {
  transactionId?: string;
  devFakePay?: boolean;
  expectedPayTo: string;
  expectedAmount: number;
  asset: string;
}): Promise<{
  ok: boolean;
  error?: string;
  mode: string;
  creditedBase?: number;
  details?: Record<string, unknown>;
}> {
  // CRITICAL SECURITY: Never allow fake payments unless explicitly enabled
  if (opts.devFakePay && !ALLOW_DEV_FAKE_SETTLEMENT) {
    return { 
      ok: false, 
      error: "devFakePay is disabled - set ALLOW_DEV_FAKE_SETTLEMENT=true for local testing only",
      mode: "rejected" 
    };
  }
  
  // EXTRA SAFETY: In production with real settlement, require explicit confirmation
  // This is a second layer - even if ALLOW_DEV_FAKE_SETTLEMENT=true accidentally,
  // production deployment needs DEV_FAKE_PAYMENT_CONFIRMED to accept fake payments
  if (opts.devFakePay && process.env.STRICT_SETTLEMENT === "true") {
    const confirmEnv = process.env.DEV_FAKE_PAYMENT_CONFIRMED;
    if (confirmEnv !== "yes_i_know_what_i_am_doing") {
      return { 
        ok: false, 
        error: "Security: devFakePay with STRICT_SETTLEMENT requires DEV_FAKE_PAYMENT_CONFIRMED env var",
        mode: "security_warning" 
      };
    }
  }
  
  if (opts.devFakePay) {
    return { 
      ok: true, 
      mode: "dev_fake",
      details: { note: "⚠️ DEVELOPMENT MODE ONLY - Do not use in production" }
    };
  }

  if (!opts.transactionId) {
    return { ok: false, error: "transactionId required", mode: "missing_tx" };
  }

  const txId = normalizeTxId(opts.transactionId);
  if (db.isTxUsed(txId) || db.isTxUsed(opts.transactionId)) {
    return {
      ok: false,
      error: "TRANSACTION_ALREADY_USED",
      mode: "replay",
    };
  }

  const fetched = await fetchMirrorTransaction(txId);
  if (!fetched.ok || !fetched.tx) {
    return {
      ok: false,
      error: fetched.error || "mirror miss",
      mode: "mirror_miss",
    };
  }
  const t = fetched.tx;
  if (t.result && t.result !== "SUCCESS") {
    return {
      ok: false,
      error: `Tx result ${t.result}`,
      mode: "tx_fail",
    };
  }

  const asset = (opts.asset || "HBAR").toUpperCase();
  const minBase = toBaseUnits(
    asset === "USDC" ? "USDC" : "HBAR",
    opts.expectedAmount
  );

  if (asset === "USDC") {
    if (!USDC_TOKEN_ID) {
      return {
        ok: false,
        error: "USDC_TOKEN_ID not configured",
        mode: "usdc_not_live",
      };
    }
    const tokenTransfers = collectTokenCredits(t, USDC_TOKEN_ID);
    const check = creditToPayee(
      tokenTransfers,
      opts.expectedPayTo,
      minBase
    );
    if (!check.ok) {
      if (STRICT_SETTLEMENT) {
        return {
          ok: false,
          error: check.reason || "USDC transfer not verified",
          mode: "usdc_strict_fail",
          details: {
            tokenId: USDC_TOKEN_ID,
            payTo: opts.expectedPayTo,
            minBase,
            credited: check.credited,
            transfers: tokenTransfers.slice(0, 20),
          },
        };
      }
      return {
        ok: true,
        mode: `mirror_${NETWORK}_usdc_soft`,
        creditedBase: check.credited,
      };
    }
    return {
      ok: true,
      mode: `mirror_${NETWORK}_usdc_strict`,
      creditedBase: check.credited,
    };
  }

  // HBAR
  const hbarTransfers = collectHbarCredits(t);
  const check = creditToPayee(hbarTransfers, opts.expectedPayTo, minBase);
  if (!check.ok) {
    if (STRICT_SETTLEMENT) {
      return {
        ok: false,
        error: check.reason || "HBAR transfer not verified",
        mode: "hbar_strict_fail",
        details: {
          payTo: opts.expectedPayTo,
          minBase,
          credited: check.credited,
          transfers: hbarTransfers.slice(0, 20),
        },
      };
    }
    // Soft: success on mirror but no payee match (legacy demo)
    return {
      ok: true,
      mode: `mirror_${NETWORK}_hbar_soft`,
      creditedBase: check.credited,
    };
  }
  return {
    ok: true,
    mode: `mirror_${NETWORK}_hbar_strict`,
    creditedBase: check.credited,
  };
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
    return { summary, chars: text.length, mode: "truncate" };
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

/**
 * Prefer webhook → LLM (tokenrouter) for NLP caps → inline stub.
 */
export async function fulfillOffer(
  offer: {
    capability: string;
    fulfillmentType?: string;
    webhookUrl?: string;
    maxSeconds?: number;
  },
  input?: Record<string, unknown>,
  meta?: { orderId?: string; offerId?: string }
): Promise<unknown> {
  if (offer.fulfillmentType === "webhook" && offer.webhookUrl) {
    const wr = await fetch(offer.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: meta?.orderId,
        offerId: meta?.offerId,
        input,
      }),
      signal: AbortSignal.timeout((offer.maxSeconds || 30) * 1000),
    });
    return await wr.json().catch(() => ({ status: wr.status }));
  }

  const llmCaps = new Set([
    "text.summarize",
    "text.reply",
    "agent.answer",
    "llm.complete",
    "text.translate",
    "code.review",
    "text.sentiment",
    "text.classify",
    "text.extract",
  ]);
  if (
    process.env.LLM_FULFILL_ENABLED !== "false" &&
    (llmCaps.has(offer.capability) || offer.fulfillmentType === "llm")
  ) {
    try {
      const { llmFulfill } = await import("./llm");
      const r = await llmFulfill(offer.capability, input);
      if (r.ok) return r.result;
      // fall through to inline with note
      const inline = fulfillInline(offer.capability, input);
      return {
        ...(typeof inline === "object" && inline ? inline : { inline }),
        llmError: !r.ok ? r.error : "unknown",
      };
    } catch (e) {
      const inline = fulfillInline(offer.capability, input);
      return {
        ...(typeof inline === "object" && inline ? inline : { inline }),
        llmError: e instanceof Error ? e.message : "llm_import_failed",
      };
    }
  }

  return fulfillInline(offer.capability, input);
}

export function createEscrowForOrder(opts: {
  orderId: string;
  amount: number;
  asset: string;
  buyerWallet?: string;
  sellerAgentId: string;
  /** seconds until auto-refund eligible (default 72h) */
  lockSeconds?: number;
}): EscrowRecord {
  const now = new Date();
  const lockSeconds = opts.lockSeconds ?? Number(process.env.ESCROW_LOCK_SECONDS || 72 * 3600);
  const expiresAt = new Date(now.getTime() + lockSeconds * 1000).toISOString();
  const e: EscrowRecord = {
    id: newId("esc"),
    orderId: opts.orderId,
    status: "locked",
    amount: opts.amount,
    asset: opts.asset,
    buyerWallet: opts.buyerWallet,
    sellerAgentId: opts.sellerAgentId,
    expiresAt,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  db.putEscrow(e);
  return e;
}

/** Auto-refund locked escrows past expiresAt */
export function expireEscrows(now = Date.now()): EscrowRecord[] {
  const expired: EscrowRecord[] = [];
  for (const e of db.listEscrows()) {
    if (e.status !== "locked" || !e.expiresAt) continue;
    if (new Date(e.expiresAt).getTime() > now) continue;
    e.status = "refunded";
    e.reason = "auto_timeout";
    e.updatedAt = new Date().toISOString();
    db.putEscrow(e);
    const order = db.getOrder(e.orderId);
    if (order) {
      order.status = "failed";
      order.error = "escrow_timeout";
      order.result = { escrowId: e.id, refunded: true, reason: "auto_timeout" };
      order.completedAt = new Date().toISOString();
      db.putOrder(order);
    }
    expired.push(e);
  }
  return expired;
}

export function usdcMeta() {
  return {
    tokenId: USDC_TOKEN_ID || null,
    decimals: USDC_DECIMALS,
    live: Boolean(USDC_TOKEN_ID),
    strictSettlement: STRICT_SETTLEMENT,
    note: USDC_TOKEN_ID
      ? "HTS USDC configured — token transfers verified on mirror"
      : "Set USDC_TOKEN_ID to enable USDC settlement",
  };
}
