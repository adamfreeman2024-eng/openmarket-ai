/**
 * Webhook seller health — Phase 7.1
 *
 * Periodically (or on demand) probes seller webhook endpoints.
 * Unhealthy webhooks get a ranking penalty and surface as webhookHealthy:false
 * on public DTOs so buyers don't hire dead sellers.
 *
 * Probe strategy:
 *  1. Prefer GET {origin}/health (Hermes bot / managed agents)
 *  2. Else HEAD/GET the webhook URL with short timeout (2xx/4xx = up, 5xx/timeout = down)
 *
 * State lives in Redis/memory via lib/cache (TTL 120s default).
 */
import { cache } from "./cache";
import { assertSafeOutboundUrl } from "./ssrf";
import { log } from "./logger";
import { notifyWebhook } from "./webhooks";
import { db } from "./store";

export type WebhookHealth = {
  url: string;
  ok: boolean;
  status?: number;
  latencyMs: number;
  checkedAt: string;
  error?: string;
  probe: "health" | "webhook";
};

const TTL_SECONDS = Number(process.env.WEBHOOK_HEALTH_TTL_SECONDS || 120);
const PROBE_MS = Number(process.env.WEBHOOK_HEALTH_TIMEOUT_MS || 2500);

function cacheKey(url: string): string {
  return `wh_health:${url}`;
}

/** Derive a /health URL from a fulfillment webhook URL when possible. */
export function deriveHealthUrl(webhookUrl: string): string | null {
  try {
    const u = new URL(webhookUrl);
    const path = u.pathname.replace(/\/$/, "") || "";
    if (path.endsWith("/webhook")) {
      u.pathname = path.slice(0, -"/webhook".length) + "/health" || "/health";
      return u.toString();
    }
    // Same origin /health
    const h = new URL(webhookUrl);
    h.pathname = "/health";
    h.search = "";
    h.hash = "";
    return h.toString();
  } catch {
    return null;
  }
}

export async function getCachedWebhookHealth(
  url: string
): Promise<WebhookHealth | null> {
  if (!url) return null;
  return (await cache.get<WebhookHealth>(cacheKey(url))) || null;
}

export async function isWebhookHealthy(url?: string | null): Promise<boolean | null> {
  if (!url) return null;
  const cached = await getCachedWebhookHealth(url);
  if (cached) return cached.ok;
  return null; // unknown — do not penalize until checked
}

export async function probeWebhookHealth(webhookUrl: string): Promise<WebhookHealth> {
  const checkedAt = new Date().toISOString();
  const safe = await assertSafeOutboundUrl(webhookUrl);
  if (safe.ok === false) {
    const bad: WebhookHealth = {
      url: webhookUrl,
      ok: false,
      latencyMs: 0,
      checkedAt,
      error: `ssrf:${safe.error}`,
      probe: "webhook",
    };
    await cache.set(cacheKey(webhookUrl), bad, TTL_SECONDS);
    return bad;
  }

  const healthUrl = deriveHealthUrl(webhookUrl);
  const targets: Array<{ url: string; probe: "health" | "webhook" }> = [];
  if (healthUrl && healthUrl !== webhookUrl) {
    targets.push({ url: healthUrl, probe: "health" });
  }
  targets.push({ url: webhookUrl, probe: "webhook" });

  let last: WebhookHealth = {
    url: webhookUrl,
    ok: false,
    latencyMs: 0,
    checkedAt,
    error: "no_probe",
    probe: "webhook",
  };

  for (const t of targets) {
    const tSafe = await assertSafeOutboundUrl(t.url);
    if (tSafe.ok === false) continue;
    const t0 = Date.now();
    try {
      const res = await fetch(t.url, {
        method: t.probe === "health" ? "GET" : "HEAD",
        signal: AbortSignal.timeout(PROBE_MS),
        redirect: "manual",
      });
      const latencyMs = Date.now() - t0;
      // 2xx–404 on health = process is up (auth 401 also = up)
      const ok = res.status < 500;
      last = {
        url: webhookUrl,
        ok,
        status: res.status,
        latencyMs,
        checkedAt,
        error: ok ? undefined : `HTTP_${res.status}`,
        probe: t.probe,
      };
      if (ok) break;
      // HEAD may be rejected — try GET once for webhook probe
      if (t.probe === "webhook" && (res.status === 405 || res.status === 501)) {
        const t1 = Date.now();
        const res2 = await fetch(t.url, {
          method: "GET",
          signal: AbortSignal.timeout(PROBE_MS),
          redirect: "manual",
        });
        const ok2 = res2.status < 500;
        last = {
          url: webhookUrl,
          ok: ok2,
          status: res2.status,
          latencyMs: Date.now() - t1,
          checkedAt,
          error: ok2 ? undefined : `HTTP_${res2.status}`,
          probe: "webhook",
        };
        if (ok2) break;
      }
    } catch (e) {
      last = {
        url: webhookUrl,
        ok: false,
        latencyMs: Date.now() - t0,
        checkedAt,
        error: e instanceof Error ? e.message : "probe_failed",
        probe: t.probe,
      };
    }
  }

  await cache.set(cacheKey(webhookUrl), last, TTL_SECONDS);
  return last;
}

export type HealthSweepResult = {
  checked: number;
  healthy: number;
  unhealthy: number;
  results: WebhookHealth[];
  alerted: boolean;
};

/**
 * Probe all unique webhook URLs currently on active offers + agents.
 * Optionally alert operator when previously-unknown or flapping downs appear.
 */
export async function runWebhookHealthSweep(opts?: {
  alert?: boolean;
  limit?: number;
}): Promise<HealthSweepResult> {
  const urls = new Set<string>();
  for (const o of db.listOffers()) {
    if (o.active && o.webhookUrl) urls.add(o.webhookUrl);
  }
  for (const a of db.listAgents()) {
    if (a.webhookUrl) urls.add(a.webhookUrl);
  }
  const list = Array.from(urls).slice(0, opts?.limit ?? 50);
  const results: WebhookHealth[] = [];
  for (const u of list) {
    results.push(await probeWebhookHealth(u));
  }
  const healthy = results.filter((r) => r.ok).length;
  const unhealthy = results.length - healthy;

  let alerted = false;
  if (opts?.alert !== false && unhealthy > 0) {
    alerted = await alertUnhealthyWebhooks(results.filter((r) => !r.ok));
  }

  log.info(
    { checked: results.length, healthy, unhealthy, alerted },
    "webhook health sweep"
  );
  return { checked: results.length, healthy, unhealthy, results, alerted };
}

async function alertUnhealthyWebhooks(bad: WebhookHealth[]): Promise<boolean> {
  if (!bad.length) return false;
  const cd = await cache.get<number>("wh_health:alert_cd");
  if (cd) return false;
  await cache.set("wh_health:alert_cd", 1, 900); // 15 min

  const msg = {
    event: "alert.webhook_unhealthy",
    count: bad.length,
    samples: bad.slice(0, 5).map((b) => ({
      url: b.url.replace(/\/\/[^/]+@/, "//***@").slice(0, 120),
      error: b.error,
      status: b.status,
    })),
    message: `${bad.length} seller webhook(s) unhealthy — ranking penalty applied`,
  };

  let ok = false;
  const hook = process.env.ALERT_WEBHOOK_URL?.trim();
  if (hook) {
    const r = await notifyWebhook(hook, "alert", msg);
    ok = r.ok;
  }
  // Telegram fallback (same as error-alert)
  const tg = await sendTelegramAlert(
    `⚠️ AgentBazaar: ${bad.length} webhook(s) DOWN\n` +
      bad
        .slice(0, 3)
        .map((b) => `• ${b.error || b.status || "down"}`)
        .join("\n")
  );
  return ok || tg;
}

export async function sendTelegramAlert(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chat) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text: text.slice(0, 3500),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
