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
  const list = (tx.transfers as Transfer[]) || [];
  return list;
}

function collectTokenCredits(
  tx: Record<string, unknown>,
  tokenId: string
): Transfer[] {
  const out: Transfer[] = [];
  // Shape A: flat token_transfers [{token_id, account, amount}]
  const flat = tx.token_transfers as Transfer[] | undefined;
  if (Array.isArray(flat)) {
    for (const tr of flat) {
      if (tr.token_id === tokenId) out.push(tr);
    }
  }
  // Shape B: nft_transfers / tokens nested (some mirror versions)
  const nested = tx.tokens as
    | Array<{ token_id?: string; transfers?: Transfer[] }>
    | undefined;
  if (Array.isArray(nested)) {
    for (const t of nested) {
      if (t.token_id === tokenId && Array.isArray(t.transfers)) {
        for (const tr of t.transfers) out.push({ ...tr, token_id: tokenId });
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
  if (opts.devFakePay) {
    if (!ALLOW_DEV_FAKE_SETTLEMENT) {
      return { ok: false, error: "devFakePay disabled", mode: "rejected" };
    }
    return { ok: true, mode: "dev_fake" };
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
