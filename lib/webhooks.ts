/**
 * Best-effort outbound webhooks (seller/buyer notifications).
 */
export async function notifyWebhook(
  url: string | undefined,
  event: string,
  payload: Record<string, unknown>
) {
  if (!url) return { ok: false, skipped: true as const };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenMarket-Event": event,
      },
      body: JSON.stringify({ event, ...payload, at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "webhook failed",
    };
  }
}
