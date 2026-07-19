/**
 * Best-effort outbound webhooks (seller/buyer notifications).
 * Features:
 *   - HMAC signature (X-OpenMarket-Signature) for verification
 *   - Retry with exponential backoff (3 attempts)
 *   - Configurable timeout
 */
import { createHmac } from "crypto";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const MAX_RETRIES = 3;
const BASE_TIMEOUT_MS = 8000;

/** Sign payload with HMAC-SHA256 */
function signPayload(body: string): string {
  if (!WEBHOOK_SECRET) return "";
  return createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

/** Single webhook attempt */
async function attemptWebhook(
  url: string,
  body: string,
  signature: string,
  timeoutMs: number
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-OpenMarket-Event": "notification",
    };
    if (signature) {
      headers["X-OpenMarket-Signature"] = `sha256=${signature}`;
    }
    const r = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "webhook failed",
    };
  }
}

/**
 * Notify a webhook URL with retry logic.
 * Retries on failure with exponential backoff (3 attempts).
 */
export async function notifyWebhook(
  url: string | undefined,
  event: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; status?: number; error?: string; attempts?: number }> {
  if (!url) return { ok: false, error: "no webhook url" };

  const body = JSON.stringify({ event, ...payload, at: new Date().toISOString() });
  const signature = signPayload(body);

  let lastError = "";
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const timeoutMs = BASE_TIMEOUT_MS * attempt;
    const result = await attemptWebhook(url, body, signature, timeoutMs);

    if (result.ok) {
      return { ok: true, status: result.status, attempts: attempt };
    }

    lastError = result.error || `HTTP ${result.status}`;
    lastStatus = result.status;

    // Don't retry on 4xx (client errors)
    if (result.status && result.status >= 400 && result.status < 500) {
      break;
    }

    // Exponential backoff: 1s, 2s, 4s
    if (attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
    }
  }

  return { ok: false, status: lastStatus, error: lastError, attempts: MAX_RETRIES };
}

/** Verify webhook signature (for receiving webhooks) */
export function verifyWebhookSignature(
  body: string,
  signature: string
): boolean {
  if (!WEBHOOK_SECRET) return true; // No secret configured = no verification
  const expected = signPayload(body);
  const received = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (!expected || !received) return false;
  // Timing-safe comparison
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}
