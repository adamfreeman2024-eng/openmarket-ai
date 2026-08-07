import { NextRequest } from "next/server";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { restartManagedAgent } from "@/lib/managed-hosting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** POST /api/v1/managed/agents/:id/restart — restart a managed agent (auth). */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const { id } = await ctx.params;
  const managed = restartManagedAgent(id);
  if (!managed) return json({ ok: false, error: "Managed agent not found" }, 404);

  return json({
    ok: true,
    managed: {
      id: managed.id,
      status: managed.status,
      pid: managed.pid ?? null,
      port: managed.port ?? null,
      restartCount: managed.restartCount,
    },
  });
}
