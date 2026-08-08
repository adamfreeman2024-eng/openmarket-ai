import { describe, it, expect, afterEach } from "vitest";
import {
  executeWorkflow,
} from "../lib/workflow";
import {
  putWorkflow,
  getWorkflow,
  listWorkflows,
  deleteWorkflow,
  putRun,
  getRun,
  listRuns,
  newWorkflowId,
} from "../lib/workflow-store";
import type { WorkflowRecord } from "../lib/workflow-types";

// NOTE: workflow-store persists to data/workflows.json (harmless, same pattern as
// dispute tests). Unique ids per test keep the in-memory store isolated. Workflows
// are deleted in afterEach; runs are filtered by workflowId so stale runs don't
// leak into assertions.

function makeWorkflow(over: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    id: newWorkflowId(),
    ownerAgentId: "demo",
    name: "test-wf",
    nodes: [
      {
        id: "n1",
        capability: "echo.demo",
        title: "Echo",
        input: { text: "hi" },
      },
    ],
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

afterEach(() => {
  for (const w of listWorkflows()) deleteWorkflow(w.id);
});

describe("Workflow store CRUD", () => {
  it("putWorkflow/getWorkflow round-trips a record", () => {
    const wf = makeWorkflow();
    putWorkflow(wf);
    expect(getWorkflow(wf.id)?.id).toBe(wf.id);
    expect(getWorkflow(wf.id)?.nodes.length).toBe(1);
  });

  it("listWorkflows filters by owner", () => {
    const wf = makeWorkflow({ ownerAgentId: "owner-a" });
    putWorkflow(wf);
    expect(listWorkflows("owner-a").some((w) => w.id === wf.id)).toBe(true);
    expect(listWorkflows("owner-b").some((w) => w.id === wf.id)).toBe(false);
  });

  it("deleteWorkflow removes the record", () => {
    const wf = makeWorkflow();
    putWorkflow(wf);
    expect(deleteWorkflow(wf.id)).toBe(true);
    expect(getWorkflow(wf.id)).toBeUndefined();
    expect(deleteWorkflow(wf.id)).toBe(false);
  });

  it("putRun/getRun/listRuns round-trips runs", () => {
    const wf = makeWorkflow();
    putWorkflow(wf);
    const run = {
      id: `wfr_test_${Date.now()}`,
      workflowId: wf.id,
      ownerAgentId: "demo",
      status: "running" as const,
      steps: [],
      createdAt: new Date().toISOString(),
    };
    putRun(run);
    expect(getRun(run.id)?.id).toBe(run.id);
    const summaries = listRuns(wf.id);
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0].workflowId).toBe(wf.id);
  });
});

describe("executeWorkflow", () => {
  it("returns a failed run for a missing workflow", async () => {
    const run = await executeWorkflow("wf_missing_xyz");
    expect(run.status).toBe("failed");
    expect(run.workflowId).toBe("wf_missing_xyz");
  });

  it("completes a single-node workflow with inline fulfillment", async () => {
    const wf = makeWorkflow({
      nodes: [
        {
          id: "n1",
          capability: "echo.demo",
          title: "Echo",
          input: { text: "hello workflow" },
        },
      ],
    });
    putWorkflow(wf);
    const run = await executeWorkflow(wf.id);
    expect(run.status).toBe("completed");
    expect(run.steps[0].status).toBe("completed");
    expect(run.finalOutput).toBeDefined();
    const n1 = (run.finalOutput as Record<string, unknown>)["n1"] as {
      echo?: { text?: string };
    };
    expect(n1?.echo?.text).toBe("hello workflow");
  });

  it("runs a multi-node DAG in dependency order and aggregates outputs", async () => {
    const wf = makeWorkflow({
      nodes: [
        { id: "sum", capability: "text.summarize", title: "Summarize", input: { text: "A".repeat(200) } },
        {
          id: "echo",
          capability: "echo.demo",
          title: "Echo summary",
          input: { text: "$nodes.sum.summary" },
          dependsOn: ["sum"],
        },
      ],
    });
    putWorkflow(wf);
    const run = await executeWorkflow(wf.id);
    expect(run.status).toBe("completed");
    const outputs = run.finalOutput as Record<string, unknown>;
    const sum = outputs["sum"] as { summary?: string };
    const echo = outputs["echo"] as { echo?: { text?: string } };
    expect(typeof sum?.summary).toBe("string");
    expect(sum?.summary?.length).toBeGreaterThan(0);
    // ref resolution: echo input references the summary output
    expect(echo?.echo?.text).toBe(sum?.summary);
  });

  it("resolves $nodes refs with a property selector", async () => {
    const wf = makeWorkflow({
      nodes: [
        { id: "a", capability: "echo.demo", title: "A", input: { text: "payload-1" } },
        {
          id: "b",
          capability: "echo.demo",
          title: "B",
          input: { text: "got:$nodes.a.echo.text" },
          dependsOn: ["a"],
        },
      ],
    });
    putWorkflow(wf);
    const run = await executeWorkflow(wf.id);
    expect(run.status).toBe("completed");
    const outputs = run.finalOutput as Record<string, unknown>;
    const b = outputs["b"] as { echo?: { text?: string } };
    expect(b?.echo?.text).toBe("got:payload-1");
  });

  it("fails the run when the workflow graph has a cycle", async () => {
    const wf = makeWorkflow({
      nodes: [
        { id: "x", capability: "echo.demo", title: "X", input: { text: "1" }, dependsOn: ["y"] },
        { id: "y", capability: "echo.demo", title: "Y", input: { text: "2" }, dependsOn: ["x"] },
      ],
    });
    putWorkflow(wf);
    const run = await executeWorkflow(wf.id);
    expect(run.status).toBe("failed");
    expect(run.steps.every((s) => s.status === "failed")).toBe(true);
    expect(run.steps[0].error).toMatch(/cycle/i);
  });

  it("completes nodes without dependsOn even when a missing dep reference exists", async () => {
    // dependsOn referencing a non-existent node is tolerated by topoSort
    const wf = makeWorkflow({
      nodes: [
        { id: "n1", capability: "echo.demo", title: "Echo", input: { text: "solo" }, dependsOn: ["ghost"] },
      ],
    });
    putWorkflow(wf);
    const run = await executeWorkflow(wf.id);
    expect(run.status).toBe("completed");
  });

  it("records run history via listRuns", async () => {
    const wf = makeWorkflow();
    putWorkflow(wf);
    await executeWorkflow(wf.id);
    const runs = listRuns(wf.id);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].status).toBe("completed");
  });
});
