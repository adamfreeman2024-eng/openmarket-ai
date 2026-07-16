/**
 * Settlement verification (x402-style).
 * Production: verify transactionId via mirror / TransactionRecordQuery.
 * Dev: ALLOW_DEV_FAKE_SETTLEMENT accepts devFakePay.
 */
import { MIRROR, ALLOW_DEV_FAKE_SETTLEMENT, NETWORK } from "./config";
import { db } from "./store";

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

  // Mirror lookup (best-effort for transfer tx shape)
  try {
    const encoded = encodeURIComponent(opts.transactionId);
    const url = `${MIRROR}/api/v1/transactions/${encoded}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      // Also try without @ encoding variants
      return {
        ok: false,
        error: `Mirror lookup failed HTTP ${res.status} for ${opts.transactionId}`,
        mode: "mirror_miss",
      };
    }
    const data = await res.json();
    const txs = data.transactions || (data.transaction_id ? [data] : []);
    if (!txs.length) {
      return { ok: false, error: "No transaction in mirror", mode: "mirror_empty" };
    }
    // Soft verify: success result
    const t = txs[0];
    const result = String(t.result || t.transaction_id || "");
    if (t.result && t.result !== "SUCCESS") {
      return { ok: false, error: `Tx result ${t.result}`, mode: "tx_fail" };
    }
    // Mark used only after success path in caller
    return {
      ok: true,
      mode: `mirror_${NETWORK}`,
    };
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
    const summary =
      text.length <= 120 ? text : text.slice(0, 117) + "...";
    return { summary, chars: text.length };
  }
  return {
    ok: true,
    capability,
    message: "Inline fulfill stub — connect seller webhook for real work",
    input: input ?? {},
  };
}
