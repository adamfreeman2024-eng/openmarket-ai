import { NextRequest } from "next/server";
import { ensureSeedCatalog } from "@/lib/store";
import {
  json,
  options,
  requireAgent,
  isResponse,
  readJsonBody,
  rateLimitResponse,
} from "@/lib/http";
import { redisRateLimit, clientKey } from "@/lib/rate-limit";
import { discoverForGoal } from "@/lib/smart-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * POST /api/v1/discover
 * Body: { "goal": "Summarize this article then translate to Armenian" }
 * Auth: X-Api-Key recommended (rate-limited harder without key).
 */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const rl = await redisRateLimit(`discover:${clientKey(req)}`, 30, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  // Optional auth — if key present must be valid
  const maybeKey =
    req.headers.get("x-api-key") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (maybeKey) {
    const agent = requireAgent(req);
    if (isResponse(agent)) return agent;
  }

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const goal = String((body.data as { goal?: unknown })?.goal || "").trim();
  if (goal.length < 3) {
    return json(
      { ok: false, error: "`goal` string required (min 3 chars)" },
      400
    );
  }

  const result = await discoverForGoal(goal);
  return json({ ok: true, ...result });
}

/** GET /api/v1/discover?goal=... — same as POST for easy agent probing */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const rl = await redisRateLimit(`discover:${clientKey(req)}`, 30, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);
  const goal = (req.nextUrl.searchParams.get("goal") || "").trim();
  if (goal.length < 3) {
    return json(
      {
        ok: false,
        error: "Pass ?goal= or POST { goal }",
        example:
          'GET /api/v1/discover?goal=translate%20hello%20to%20Armenian',
      },
      400
    );
  }
  const result = await discoverForGoal(goal);
  return json({ ok: true, ...result });
}
