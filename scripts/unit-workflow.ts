/**
 * Workflow engine unit test (isolated data dir).
 * Run: OM_DATA_DIR=/tmp/wf-test npx tsx scripts/unit-workflow.ts
 */
import { putWorkflow, getWorkflow, listRuns } from "../lib/workflow-store";
import { executeWorkflow } from "../lib/workflow";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

async function main() {
  console.log("== Workflow engine test ==");

  const wf = putWorkflow({
    id: "wf_unit_1",
    ownerAgentId: "unit-test",
    name: "Unit workflow",
    nodes: [
      {
        id: "n1",
        capability: "text.summarize",
        title: "summarize",
        input: { text: "This is a fairly long sentence that we want summarized." },
      },
      {
        id: "n2",
        capability: "text.translate",
        title: "translate",
        dependsOn: ["n1"],
        input: { targetLang: "hy" },
      },
    ],
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const run = await executeWorkflow(wf.id, {});
  check("workflow completed", run.status === "completed", `status=${run.status}`);
  check("2 steps recorded", run.steps.length === 2, `steps=${run.steps.length}`);
  check("step n1 completed", run.steps[0]?.status === "completed", run.steps[0]?.error || "");
  check("step n2 completed", run.steps[1]?.status === "completed", run.steps[1]?.error || "");
  const outObj = (run.finalOutput ?? {}) as Record<string, unknown>;
  check("finalOutput has n1", "n1" in outObj, "missing n1 output");
  check("finalOutput has n2", "n2" in outObj, "missing n2 output");
  check("runs listable", listRuns(wf.id).length === 1, `runs=${listRuns(wf.id).length}`);
  check("workflow persisted", Boolean(getWorkflow(wf.id)));

  // cycle detection
  const cyc = putWorkflow({
    id: "wf_unit_cycle",
    ownerAgentId: "unit-test",
    name: "Cycle",
    nodes: [
      { id: "a", capability: "text.summarize", title: "a", dependsOn: ["b"] },
      { id: "b", capability: "text.summarize", title: "b", dependsOn: ["a"] },
    ],
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const cycRun = await executeWorkflow(cyc.id, {});
  check("cycle rejected", cycRun.status === "failed", `status=${cycRun.status}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
