/**
 * Built-in webhook fulfill endpoint for demo sellers.
 * POST /api/v1/demo/fulfill — returns echo result (public demo only).
 * Production sellers should host their own webhook.
 */
import { NextRequest } from "next/server";
import { json, options, readJsonBody, rateLimitResponse } from "@/lib/http";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

export async function GET() {
  return json({
    ok: true,
    service: "openmarket-demo-webhook",
    usage: "POST with OpenMarket fulfillment_request body",
  });
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(`demo-fulfill:${clientKey(req)}`, 120, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const bodyRes = await readJsonBody(req);
  if (!bodyRes.ok) return bodyRes.response;
  const body = (bodyRes.data || {}) as Record<string, unknown>;
  const input = (body.input || {}) as Record<string, unknown>;
  const orderId =
    req.headers.get("x-openmarket-order-id") || (body.orderId as string) || null;
  const capability = (body.capability as string) || "demo.webhook";

  return json({
    ok: true,
    fulfilledBy: "openmarket-demo-webhook",
    event: req.headers.get("x-openmarket-event") || "fulfillment_request",
    orderId,
    capability,
    echo: input,
    message:
      typeof input.text === "string"
        ? `Demo webhook processed: ${input.text}`
        : "Demo webhook fulfillment OK",
    timestamp: new Date().toISOString(),
  });
}
