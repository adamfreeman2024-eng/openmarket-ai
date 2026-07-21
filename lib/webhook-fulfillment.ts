/**
 * Webhook auto-fulfillment — sellers register a webhook URL,
 * and when an order comes in, OpenMarket calls the webhook
 * and returns the result to the buyer automatically.
 *
 * Flow:
 *   1. Seller creates offer with fulfillmentType="webhook"
 *   2. Buyer buys → order created → payment verified
 *   3. OpenMarket calls seller's webhook URL with order data
 *   4. Seller's server processes and returns result
 *   5. OpenMarket returns result to buyer
 *
 * This replaces the old "manual fulfillment" model.
 */

/** Call seller webhook and return result */
export async function callWebhookForFulfillment(opts: {
  webhookUrl: string;
  orderId: string;
  offerId: string;
  capability: string;
  input?: Record<string, unknown>;
  maxSeconds?: number;
}): Promise<{ ok: boolean; result?: unknown; error?: string; latencyMs?: number }> {
  const { webhookUrl, orderId, offerId, capability, input, maxSeconds = 30 } = opts;
  const t0 = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), maxSeconds * 1000);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenMarket-Event": "fulfillment_request",
        "X-OpenMarket-Order-Id": orderId,
        "X-OpenMarket-Offer-Id": offerId,
      },
      body: JSON.stringify({
        orderId,
        offerId,
        capability,
        input: input || {},
        timestamp: new Date().toISOString(),
      }),
      signal: controller.signal,
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
      result = await response.text();
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
  const crypto = require("crypto") as typeof import("crypto");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  const received = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}
