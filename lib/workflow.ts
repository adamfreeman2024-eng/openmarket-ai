/**
 * Workflow execution engine — runs a DAG of agent-capability steps.
 * Each step finds an active offer for its capability and fulfills it.
 * Outputs aggregate; a node can reference previous outputs via $nodes.<id>.
 */
import { db } from "./store";
import { fulfillOffer } from "./settlement";
import type { WorkflowNode, WorkflowRun, WorkflowStepRun } from "./workflow-types";
import {
  putWorkflow,
  putRun,
  newRunId,
  getWorkflow,
} from "./workflow-store";

/** Resolve "$nodes.<id>" references in input values with step results. */
function resolveRefs(
  value: unknown,
  outputs: Record<string, unknown>
): unknown {
  if (typeof value === "string") {
    return value.replace(/\$nodes\.([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9_-]+))?/g, (m, id, key) => {
      const out = outputs[id];
      if (out === undefined) return m;
      if (key && typeof out === "object" && out !== null) {
        const rec = out as Record<string, unknown>;
        return rec[key] !== undefined ? String(rec[key]) : m;
      }
      return typeof out === "object" ? JSON.stringify(out) : String(out);
    });
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveRefs(v, outputs));
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      next[k] = resolveRefs(v, outputs);
    }
    return next;
  }
  return value;
}

function topoSort(nodes: WorkflowNode[]): WorkflowNode[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order: WorkflowNode[] = [];
  const state = new Map<string, "visiting" | "done">();

  function visit(n: WorkflowNode): boolean {
    const st = state.get(n.id);
    if (st === "done") return true;
    if (st === "visiting") return false; // cycle
    state.set(n.id, "visiting");
    for (const dep of n.dependsOn || []) {
      const d = byId.get(dep);
      if (!d) continue;
      if (!visit(d)) return false;
    }
    state.set(n.id, "done");
    order.push(n);
    return true;
  }

  for (const n of nodes) {
    if (!visit(n)) return null; // cycle detected
  }
  return order;
}

async function runStep(
  node: WorkflowNode,
  input: Record<string, unknown>,
  meta: { orderId: string; offerId: string }
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const offers = db.listOffers().filter(
    (o) => o.active !== false && o.capability === node.capability
  );
  const offer = offers.sort((a, b) => a.priceAmount - b.priceAmount)[0];
  try {
    if (offer) {
      const result = await fulfillOffer(
        {
          capability: offer.capability,
          fulfillmentType: offer.fulfillmentType,
          webhookUrl: offer.webhookUrl,
          maxSeconds: offer.maxSeconds,
        },
        input,
        { orderId: meta.orderId, offerId: meta.offerId, maxSeconds: offer.maxSeconds }
      );
      return { ok: true, result };
    }
    // No registered offer — fall back to inline fulfillment
    const result = await fulfillOffer(
      { capability: node.capability, fulfillmentType: "inline", maxSeconds: 30 },
      input,
      { orderId: meta.orderId, offerId: meta.offerId, maxSeconds: 30 }
    );
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "step failed" };
  }
}

/**
 * Execute a workflow synchronously, recording step progress in the run.
 * Steps run in topological order; outputs are available to downstream nodes.
 */
export async function executeWorkflow(
  workflowId: string,
  rootInput?: Record<string, unknown>
): Promise<WorkflowRun> {
  const wf = getWorkflow(workflowId);
  if (!wf) {
    const run: WorkflowRun = {
      id: newRunId(),
      workflowId,
      ownerAgentId: "",
      status: "failed",
      steps: [],
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    return putRun(run);
  }

  const run: WorkflowRun = {
    id: newRunId(),
    workflowId: wf.id,
    ownerAgentId: wf.ownerAgentId,
    status: "running",
    steps: wf.nodes.map((n) => ({
      nodeId: n.id,
      capability: n.capability,
      status: "pending",
    })),
    createdAt: new Date().toISOString(),
  };
  putRun(run);

  const ordered = topoSort(wf.nodes);
  if (!ordered) {
    run.status = "failed";
    run.completedAt = new Date().toISOString();
    for (const s of run.steps) {
      if (s.status === "pending") {
        s.status = "failed";
        s.error = "Workflow graph has a cycle";
      }
    }
    return putRun(run);
  }

  const outputs: Record<string, unknown> = {};

  for (const node of ordered) {
    const step = run.steps.find((s) => s.nodeId === node.id);
    if (!step) continue;
    step.status = "running";
    step.startedAt = new Date().toISOString();
    putRun(run);

    const mergedInput: Record<string, unknown> = {
      ...(rootInput || {}),
      ...(node.input || {}),
    };
    const resolved = resolveRefs(mergedInput, outputs) as Record<string, unknown>;

    const meta = { orderId: `wf:${run.id}:${node.id}`, offerId: node.id };
    const res = await runStep(node, resolved, meta);

    if (res.ok) {
      step.status = "completed";
      step.result = res.result;
      step.completedAt = new Date().toISOString();
      outputs[node.id] = res.result;
    } else {
      step.status = "failed";
      step.error = res.error;
      step.completedAt = new Date().toISOString();
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      for (const s of run.steps) {
        if (s.status === "pending") {
          s.status = "failed";
          s.error = "Skipped: upstream step failed";
        }
      }
      return putRun(run);
    }
    putRun(run);
  }

  run.status = "completed";
  run.completedAt = new Date().toISOString();
  run.finalOutput = outputs;
  // bump last-run timestamp on workflow
  wf.updatedAt = new Date().toISOString();
  putWorkflow(wf);
  return putRun(run);
}
