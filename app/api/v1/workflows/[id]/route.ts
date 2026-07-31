import { NextRequest } from "next/server";
import { ensureSeedCatalog } from "@/lib/store";
import { json, options, getApiKey } from "@/lib/http";
import { getWorkflow, listRuns } from "@/lib/workflow-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

function canAccess(req: NextRequest, ownerAgentId: string): boolean {
  const key = getApiKey(req);
  if (!key) return ownerAgentId === "demo";
  const { db } = require("@/lib/store") as typeof import("@/lib/store");
  const agent = db.getAgentByKey(key);
  return Boolean(agent && agent.id === ownerAgentId);
}

/** GET /api/v1/workflows/:id — workflow detail + recent runs */
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
  return json({ ok: true, workflow: wf, runs: listRuns(id) });
}
