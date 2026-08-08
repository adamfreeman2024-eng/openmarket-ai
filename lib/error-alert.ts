/**
 * 5xx error alerting — Improved Logging & Monitoring (DEVELOPMENT-PLAN Phase 1.2).
 *
 * Counts server errors (status >= 500) in a rolling window (Redis-backed with
 * in-memory fallback via lib/cache) and fires a best-effort webhook alert when
 * the count crosses a threshold, rate-limited by a cooldown so an outage
 * alerts once instead of once per request.
 *
 * Configuration (env):
 *   ALERT_WEBHOOK_URL      — required for alerts; without it errors are still
 *                            counted/logged but no webhook fires.
 *   ALERT_5XX_THRESHOLD    — errors in the window that trigger an alert (default 5)
 *   ALERT_5XX_WINDOW_SECONDS — counting window (default 600 = 10 min)
 *   ALERT_5XX_COOLDOWN_MS  — min time between alerts for the same path (default 15 min)
 *
 * Usage (fire-and-forget — never blocks or throws on the request path):
 *   import { trackServerError } from "@/lib/error-alert";
 *   ...
 *   if (status >= 500) void trackServerError("/api/v1/...", message);
 */
import { cache } from "./cache";
import { notifyWebhook } from "./webhooks";
import { log } from "./logger";

const THRESHOLD = Number(process.env.ALERT_5XX_THRESHOLD || 5);
const WINDOW_SECONDS = Number(process.env.ALERT_5XX_WINDOW_SECONDS || 600);
const COOLDOWN_MS = Number(process.env.ALERT_5XX_COOLDOWN_MS || 15 * 60 * 1000);

/** Read at call time so tests/env reloads see changes (PM2 --update-env friendly). */
function alertWebhookUrl(): string {
  return process.env.ALERT_WEBHOOK_URL?.trim() || "";
}

/** True when a webhook target is configured (used to skip tests / silence). */
export function alertConfigured(): boolean {
  return Boolean(alertWebhookUrl());
}

/**
 * Record a server error (status >= 500). Returns true when this call crossed
 * the threshold and fired (or would fire) an alert; false otherwise.
 * Async but intended to be invoked without await (`void trackServerError(...)`).
 */
export async function trackServerError(
  path: string,
  message?: string
): Promise<boolean> {
  try {
    const key = `err5xx:${path || "api"}`;
    const count = await cache.incr(key, WINDOW_SECONDS);

    // Cooldown: don't re-alert within COOLDOWN_MS of the last alert for this path.
    const cdKey = `err5xx:cd:${path || "api"}`;
    const inCooldown = await cache.get<number>(cdKey);
    if (inCooldown) return false;

    log.warn({ path, count, threshold: THRESHOLD }, "5xx error recorded");

    if (count >= THRESHOLD && alertWebhookUrl()) {
      await cache.set(cdKey, 1, Math.ceil(COOLDOWN_MS / 1000));
      const payload = {
        event: "alert.5xx",
        path,
        message:
          message ||
          `5xx error threshold crossed (${count} in ${WINDOW_SECONDS}s window)`,
        count,
        threshold: THRESHOLD,
      };
      const res = await notifyWebhook(alertWebhookUrl(), "alert", payload);
      if (!res.ok) {
        log.warn(
          { path, error: res.error, status: res.status },
          "5xx alert webhook delivery failed"
        );
      }
      // Phase 7.4 — also Telegram when configured
      try {
        const { sendTelegramAlert } = await import("./webhook-health");
        await sendTelegramAlert(
          `🚨 AgentBazaar 5xx alert\npath: ${path}\ncount: ${count}/${THRESHOLD}\n${payload.message}`
        );
      } catch {
        /* ignore */
      }
      return true;
    }
    // No ALERT_WEBHOOK_URL — still try Telegram if set
    if (count >= THRESHOLD && !alertWebhookUrl()) {
      await cache.set(cdKey, 1, Math.ceil(COOLDOWN_MS / 1000));
      try {
        const { sendTelegramAlert } = await import("./webhook-health");
        const sent = await sendTelegramAlert(
          `🚨 AgentBazaar 5xx alert\npath: ${path}\ncount: ${count}/${THRESHOLD}\n${message || "threshold crossed"}`
        );
        return sent;
      } catch {
        return false;
      }
    }
    return false;
  } catch (e) {
    log.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "error-alert tracking failed (request path unaffected)"
    );
    return false;
  }
}
