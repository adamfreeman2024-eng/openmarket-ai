/**
 * POST /api/v1/admin/webhook-health — Phase 7.1 operator sweep.
 * Probes all known seller webhooks, updates cache used by search ranking.
 * Auth: X-Api-Key === ADMIN_API_KEY
 * Body: { alert?: boolean, limit?: number }
 * GET — last sweep is live; returns cached summary by probing lightly.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { json, options, getApiKey } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import { runWebhookHealthSweep } from "@/lib/webhook-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const ADMIN_KEY = process.env.ADMIN_API_KEY?.trim() || "";

const Body = z.object({
  alert: z.boolean().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

function requireAdmin(req: NextRequest) {
  const key = getApiKey(req);
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return json({ ok: false, error: "Admin only" }, 403);
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  // Lightweight: no alert on GET
  const result = await runWebhookHealthSweep({ alert: false, limit: 30 });
  return json({ ok: true, ...result });
}

export async function POST(req: NextRequest) {
  const rl = await redisRateLimit(
    `admin-wh-health:${clientKey(req)}`,
    10,
    60_000
  );
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const denied = requireAdmin(req);
  if (denied) return denied;

  const raw = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  const alert = parsed.success ? parsed.data.alert !== false : true;
  const limit = parsed.success ? parsed.data.limit : undefined;

  const result = await runWebhookHealthSweep({ alert, limit });
  return json({ ok: true, ...result });
}
