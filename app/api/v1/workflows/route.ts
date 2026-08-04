import { NextRequest } from "next/server";
import { z } from "zod";
import { db, ensureSeedCatalog } from "@/lib/store";
import { json, options, getApiKey } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import {
  putWorkflow,
  listWorkflows,
  newWorkflowId,
} from "@/lib/workflow-store";
import type { WorkflowNode } from "@/lib/workflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const NodeSchema = z.object({
  id: z.string().min(1).max(64),
  capability: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  input: z.record(z.unknown()).optional(),
  dependsOn: z.array(z.string()).max(16).optional(),
});

const CreateSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  nodes: z.array(NodeSchema).min(1).max(20),
});

function ownerOf(req: NextRequest): { id: string; authed: boolean } {
  const key = getApiKey(req);
  const agent = key ? db.getAgentByKey(key) : undefined;
  return agent ? { id: agent.id, authed: true } : { id: "demo", authed: false };
}

/** GET /api/v1/workflows — list workflows (mine, or demo if no API key) */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const owner = ownerOf(req);
  const workflows = listWorkflows(owner.id).map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    nodes: w.nodes,
    active: w.active,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  }));
  return json({ ok: true, owner: owner.id, count: workflows.length, workflows });
}

/** POST /api/v1/workflows — create a workflow (agent auth or demo) */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const rl = await redisRateLimit(`workflow-create:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);
  const owner = ownerOf(req);

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { ok: false, error: "Invalid body", details: parsed.error.flatten() },
      400
    );
  }

  const ids = new Set<string>();
  for (const n of parsed.data.nodes) {
    if (ids.has(n.id)) {
      return json({ ok: false, error: `Duplicate node id: ${n.id}` }, 400);
    }
    ids.add(n.id);
  }

  const now = new Date().toISOString();
  const wf = putWorkflow({
    id: newWorkflowId(),
    ownerAgentId: owner.id,
    name: parsed.data.name,
    description: parsed.data.description,
    nodes: parsed.data.nodes as WorkflowNode[],
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  return json({ ok: true, workflow: wf }, 201);
}
