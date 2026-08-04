import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureSeedCatalog } from "@/lib/store";
import { json, options, getApiKey } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import { getWorkflow, getRun, listRuns } from "@/lib/workflow-store";
import { executeWorkflow } from "@/lib/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const RunSchema = z.object({
  input: z.record(z.unknown()).optional(),
});

function canAccess(req: NextRequest, ownerAgentId: string): boolean {
  const key = getApiKey(req);
  if (!key) return ownerAgentId === "demo";
  const { db } = require("@/lib/store") as typeof import("@/lib/store");
  const agent = db.getAgentByKey(key);
  return Boolean(agent && agent.id === ownerAgentId);
}

/** GET /api/v1/workflows/:id/runs — list runs for a workflow */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const wf = getWorkflow(id);
  if (!wf) return json({ ok: false, error: "Not found" }, 404);
  if (!canAccess(req, wf.ownerAgentId)) {
    return json({ ok: false, error: "Forbidden" }, 403);
  }
  return json({ ok: true, runs: listRuns(id) });
}

/** POST /api/v1/workflows/:id/run — execute a workflow now */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const wf = getWorkflow(id);
  if (!wf) return json({ ok: false, error: "Not found" }, 404);
  if (!canAccess(req, wf.ownerAgentId)) {
    return json({ ok: false, error: "Forbidden" }, 403);
  }

  const rl = await redisRateLimit(`workflow-run:${clientKey(req)}`, 10, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const body = await req.json().catch(() => null);
  const parsed = RunSchema.safeParse(body || {});
  if (!parsed.success) {
    return json({ ok: false, error: "Invalid body" }, 400);
  }

  const run = await executeWorkflow(id, parsed.data.input);
  return json({
    ok: run.status === "completed",
    run,
  });
}
