import { NextRequest } from "next/server";
import { db, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import { respondToDispute } from "@/lib/dispute";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const Body = z.object({
  response: z.string().min(3).max(2000),
});

/** POST /api/v1/disputes/:id/respond — seller responds to an open dispute */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const rl = await redisRateLimit(`dispute-respond:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "response string required" }, 400);
  }

  const updated = respondToDispute(id, agent.id, parsed.data.response);
  if (!updated) {
    return json(
      { ok: false, error: "Not found, not yours, or not open" },
      404
    );
  }

  return json({ ok: true, dispute: updated });
}
