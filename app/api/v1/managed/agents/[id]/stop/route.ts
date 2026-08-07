import { NextRequest } from "next/server";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import { stopManagedAgent } from "@/lib/managed-hosting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** POST /api/v1/managed/agents/:id/stop — stop a managed agent (auth). */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const rl = await redisRateLimit(`mga-stop:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const { id } = await ctx.params;
  const managed = stopManagedAgent(id);
  if (!managed) return json({ ok: false, error: "Managed agent not found" }, 404);

  return json({
    ok: true,
    managed: {
      id: managed.id,
      status: managed.status,
      stoppedAt: managed.stoppedAt ?? null,
    },
  });
}
