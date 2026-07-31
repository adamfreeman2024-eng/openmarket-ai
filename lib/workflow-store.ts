/**
 * File-backed store for workflows + runs.
 * Separate from the main store to keep the blob file simple; same DATA_DIR.
 */
import * as fs from "fs";
import * as path from "path";
import { nanoid } from "nanoid";
import type {
  WorkflowRecord,
  WorkflowRun,
  WorkflowRunSummary,
} from "./workflow-types";

const DATA_DIR =
  process.env.OM_DATA_DIR || path.resolve(process.cwd(), "data");
const WORKFLOW_FILE = path.join(DATA_DIR, "workflows.json");

type PersistShape = {
  workflows: WorkflowRecord[];
  runs: WorkflowRun[];
};

type Shape = { workflows: Map<string, WorkflowRecord>; runs: WorkflowRun[] };

function empty(): Shape {
  return { workflows: new Map(), runs: [] };
}

function hydrate(d: PersistShape | null | undefined): Shape {
  const s = empty();
  for (const w of d?.workflows || []) s.workflows.set(w.id, w);
  s.runs = d?.runs || [];
  return s;
}

function snapshot(s: Shape): PersistShape {
  return {
    workflows: Array.from(s.workflows.values()),
    runs: s.runs.slice(-200),
  };
}

const g = globalThis as unknown as { __omWorkflowStore?: Shape };

function store(): Shape {
  if (!g.__omWorkflowStore) {
    let data: PersistShape | null = null;
    try {
      if (fs.existsSync(WORKFLOW_FILE)) {
        data = JSON.parse(fs.readFileSync(WORKFLOW_FILE, "utf8")) as PersistShape;
      }
    } catch {
      data = null;
    }
    g.__omWorkflowStore = hydrate(data);
  }
  return g.__omWorkflowStore;
}

function persist() {
  try {
    const payload = snapshot(store());
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = WORKFLOW_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, WORKFLOW_FILE);
  } catch (e) {
    console.error("[workflow-store] persist failed", e);
  }
}

export function newWorkflowId(): string {
  return `wf_${nanoid(12)}`;
}
export function newRunId(): string {
  return `wfr_${nanoid(12)}`;
}

export function putWorkflow(w: WorkflowRecord): WorkflowRecord {
  store().workflows.set(w.id, w);
  persist();
  return w;
}

export function getWorkflow(id: string): WorkflowRecord | undefined {
  return store().workflows.get(id);
}

export function listWorkflows(ownerAgentId?: string): WorkflowRecord[] {
  const all = Array.from(store().workflows.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  return ownerAgentId ? all.filter((w) => w.ownerAgentId === ownerAgentId) : all;
}

export function deleteWorkflow(id: string): boolean {
  const ok = store().workflows.delete(id);
  if (ok) persist();
  return ok;
}

export function putRun(run: WorkflowRun): WorkflowRun {
  const s = store();
  const existing = s.runs.findIndex((r) => r.id === run.id);
  if (existing >= 0) s.runs[existing] = run;
  else s.runs.push(run);
  persist();
  return run;
}

export function getRun(id: string): WorkflowRun | undefined {
  return store().runs.find((r) => r.id === id);
}

export function listRuns(workflowId: string): WorkflowRunSummary[] {
  return store()
    .runs.filter((r) => r.workflowId === workflowId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      workflowId: r.workflowId,
      status: r.status,
      stepCount: r.steps.length,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    }));
}
