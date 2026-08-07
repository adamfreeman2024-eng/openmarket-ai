/**
 * Webhook retry — re-deliver a failed webhook with the exact stored payload.
 *
 * Retries only make sense for logs that recorded the payload (post-migration).
 * Ownership is enforced: an agent may only retry its own delivery logs.
 * SSRF-hardened: outbound URL is re-checked before every attempt.
 */
import { assertSafeOutboundUrl } from "./ssrf";
import { db } from "./store";
import type { WebhookDeliveryLog } from "./types";

export type RetryResult =
  | { ok: true; log: WebhookDeliveryLog; latencyMs: number }
  | { ok: false; error: string; status?: number };

/**
 * Re-send a stored webhook delivery payload to its URL and update the same
 * delivery log record (attempts+1). Never throws — returns a result object.
 */
export async function retryWebhookDelivery(
  logId: string,
  agentId: string
): Promise<RetryResult> {
  let log: WebhookDeliveryLog | undefined;
  try {
    log = db.getWebhookLog(logId);
  } catch {
    return { ok: false, error: "Webhook log lookup failed", status: 500 };
  }
  if (!log) return { ok: false, error: "Webhook log not found", status: 404 };
  if (log.agentId !== agentId)
    return { ok: false, error: "Not your webhook delivery", status: 403 };
  if (!log.payload)
    return {
      ok: false,
      error: "No stored payload to retry (log predates payload migration)",
      status: 400,
    };

  const safe = await assertSafeOutboundUrl(log.url);
  if (safe.ok === false)
    return { ok: false, error: `Webhook URL blocked: ${safe.error}`, status: 400 };

  const t0 = Date.now();
  try {
    const resp = await fetch(safe.url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenMarket-Event": log.event,
        "X-OpenMarket-Retry": "true",
        "User-Agent": "AgentBazaar-Webhook/1.3",
      },
      body: JSON.stringify(log.payload),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    const latencyMs = Date.now() - t0;

    const updated: WebhookDeliveryLog = {
      ...log,
      ok: resp.ok,
      status: resp.status,
      error: resp.ok ? undefined : `Webhook returned HTTP ${resp.status}`,
      attempts: (log.attempts || 1) + 1,
      durationMs: latencyMs,
      createdAt: new Date().toISOString(),
    };
    try {
      db.putWebhookLog(updated);
    } catch {
      // Logging must never break the retry result.
    }
    return {
      ok: true as const,
      log: updated,
      latencyMs,
    };
  } catch (e) {
    const latencyMs = Date.now() - t0;
    const errMsg = e instanceof Error ? e.message : "Webhook retry failed";
    const updated: WebhookDeliveryLog = {
      ...log,
      ok: false,
      error: errMsg,
      attempts: (log.attempts || 1) + 1,
      durationMs: latencyMs,
      createdAt: new Date().toISOString(),
    };
    try {
      db.putWebhookLog(updated);
    } catch {
      // ignore
    }
    return { ok: false, error: errMsg, status: 502 };
  }
}
