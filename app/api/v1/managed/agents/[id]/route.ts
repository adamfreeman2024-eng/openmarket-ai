import { NextRequest } from "next/server";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { getManagedAgent, removeManagedAgent } from "@/lib/managed-hosting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

function publicManaged(m: {
  id: string;
  name: string;
  agentId: string;
  status: string;
  port?: number;
  script: string;
  startedAt?: string;
  stoppedAt?: string;
  restartCount: number;
  lastError?: string;
}) {
  return {
    id: m.id,
    name: m.name,
    agentId: m.agentId || null,
    status: m.status,
    port: m.port ?? null,
    script: m.script,
    startedAt: m.startedAt ?? null,
    stoppedAt: m.stoppedAt ?? null,
    restartCount: m.restartCount,
    lastError: m.lastError ?? null,
  };
}

/**
 * GET /api/v1/managed/agents/:id — single managed agent (auth).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const { id } = await ctx.params;
  const managed = getManagedAgent(id);
  if (!managed) return json({ ok: false, error: "Managed agent not found" }, 404);

  return json({ ok: true, managed: publicManaged(managed) });
}

/**
 * DELETE /api/v1/managed/agents/:id — stop + remove a managed agent (auth).
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const { id } = await ctx.params;
  const removed = removeManagedAgent(id);
  if (!removed) return json({ ok: false, error: "Managed agent not found" }, 404);

  return json({ ok: true, removed: id });
}
