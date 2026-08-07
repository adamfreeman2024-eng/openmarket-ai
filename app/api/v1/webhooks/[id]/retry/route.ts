import { NextRequest } from "next/server";
import { db, ensureSeedCatalog } from "@/lib/store";
import {
  json,
  options,
  requireAgent,
  isResponse,
  rateLimitResponse,
} from "@/lib/http";
import { redisRateLimit, clientKey } from "@/lib/rate-limit";
import { retryWebhookDelivery } from "@/lib/webhook-retry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * POST /api/v1/webhooks/:id/retry — re-deliver a failed webhook (owner only)
 *
 * Headers: X-Api-Key: ***
 * Returns: { ok, log, latencyMs } — log.ok tells whether delivery succeeded.
 *
 * Errors:
 *   401 missing/invalid key · 403 not your delivery · 404 unknown log
 *   400 no stored payload / blocked URL · 429 rate limit
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const rl = await redisRateLimit(`whretry:${clientKey(req)}`, 20, 60);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const { id } = await ctx.params;
  if (!id) return json({ ok: false, error: "Missing webhook log id" }, 400);

  const result = await retryWebhookDelivery(id, agent.id);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status || 400);

  const deliveryOk = result.log.ok;
  return json(
    {
      ok: true,
      delivered: deliveryOk,
      log: {
        id: result.log.id,
        agentId: result.log.agentId,
        event: result.log.event,
        ok: result.log.ok,
        status: result.log.status ?? null,
        error: result.log.error ?? null,
        attempts: result.log.attempts,
        durationMs: result.log.durationMs,
        createdAt: result.log.createdAt,
      },
      latencyMs: result.latencyMs,
    },
    deliveryOk ? 200 : 502
  );
}
