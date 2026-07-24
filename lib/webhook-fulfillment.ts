/**
 * Webhook auto-fulfillment — sellers register a webhook URL,
 * and when an order comes in, OpenMarket calls the webhook
 * and returns the result to the buyer automatically.
 *
 * SSRF-hardened: only public http(s) URLs after DNS check.
 */
import { assertSafeOutboundUrl } from "./ssrf";
import { createHmac, timingSafeEqual } from "crypto";

/** Call seller webhook and return result */
export async function callWebhookForFulfillment(opts: {
  webhookUrl: string;
  orderId: string;
  offerId: string;
  capability: string;
  input?: Record<string, unknown>;
  maxSeconds?: number;
}): Promise<{ ok: boolean; result?: unknown; error?: string; latencyMs?: number }> {
  const { webhookUrl, orderId, offerId, capability, input } = opts;
  const maxSeconds = Math.min(Math.max(opts.maxSeconds ?? 30, 1), 60);
  const t0 = Date.now();

  const safe = await assertSafeOutboundUrl(webhookUrl);
  if (safe.ok === false) {
    return { ok: false, error: `Webhook URL blocked: ${safe.error}`, latencyMs: 0 };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), maxSeconds * 1000);

    const body = JSON.stringify({
      orderId,
      offerId,
      capability,
      input: input || {},
      timestamp: new Date().toISOString(),
    });

    const response = await fetch(safe.url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenMarket-Event": "fulfillment_request",
        "X-OpenMarket-Order-Id": orderId,
        "X-OpenMarket-Offer-Id": offerId,
        "User-Agent": "AgentBazaar-Webhook/1.3",
      },
      body,
      signal: controller.signal,
      redirect: "error",
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - t0;

    if (!response.ok) {
      return {
        ok: false,
        error: `Webhook returned HTTP ${response.status}`,
        latencyMs,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    let result: unknown;

    if (contentType.includes("application/json")) {
      result = await response.json();
    } else {
      const text = await response.text();
      if (text.length > 200_000) {
        return { ok: false, error: "Webhook response too large", latencyMs };
      }
      result = text;
    }

    return { ok: true, result, latencyMs };
  } catch (e) {
    const latencyMs = Date.now() - t0;
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: `Webhook timeout after ${maxSeconds}s`, latencyMs };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Webhook call failed",
      latencyMs,
    };
  }
}

/** Verify webhook response signature (if seller uses HMAC) */
export function verifyWebhookResponse(
  body: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const received = signature.startsWith("sha256=")
    ? signature.slice(7)
    : signature;
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(received, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
