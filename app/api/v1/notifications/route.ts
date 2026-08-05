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
import { notify } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * GET /api/v1/notifications — agent notification inbox (auth required)
 *
 * Headers: X-Api-Key: ***
 * Query:   ?limit=50 (default 50, max 200)
 * Returns: { ok, notifications: [...], unread }
 */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const rl = await redisRateLimit(`notif:get:${clientKey(req)}`, 60, 60);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const url = new URL(req.url || "http://localhost");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);

  const notifications = notify.list(agent.id, limit);
  return json({
    ok: true,
    agentId: agent.id,
    unread: notify.unreadCount(agent.id),
    notifications,
  });
}

/**
 * POST /api/v1/notifications/read — mark all notifications read (auth required)
 *
 * Headers: X-Api-Key: ***
 * Body:    {} (optional)
 * Returns: { ok, marked }
 */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const rl = await redisRateLimit(`notif:post:${clientKey(req)}`, 30, 60);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const marked = notify.markAllRead(agent.id);
  return json({ ok: true, marked });
}
