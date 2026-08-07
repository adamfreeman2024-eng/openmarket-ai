/**
 * Unit tests for lib/managed-hosting — real in-process lifecycle:
 * create → start (spawn) → stop → remove, plus the env gate helper.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let tmpDir: string;
let scriptPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "managed-hosting-test-"));
  scriptPath = path.join(tmpDir, "agent.js");
  fs.writeFileSync(
    scriptPath,
    `setInterval(() => {}, 1000); console.log("managed agent up");`
  );
  delete process.env.MANAGED_HOSTING_ENABLED;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.MANAGED_HOSTING_ENABLED;
});

describe("managedHostingEnabled", () => {
  it("is disabled unless MANAGED_HOSTING_ENABLED=true", async () => {
    const { managedHostingEnabled } = await import("../lib/managed-hosting");
    expect(managedHostingEnabled()).toBe(false);
    process.env.MANAGED_HOSTING_ENABLED = "true";
    expect(managedHostingEnabled()).toBe(true);
  });
});

describe("managed agent lifecycle", () => {
  it("create → start → stop → remove works end to end", async () => {
    const mh = await import("../lib/managed-hosting");

    const created = mh.createManagedAgent({
      name: "Test Seller",
      script: scriptPath,
      capability: "text.translate",
      agentId: "agt_test",
      env: { EXTRA: "1" },
    });
    expect(created.id).toMatch(/^mga_/);
    expect(created.status).toBe("starting");
    expect(created.agentId).toBe("agt_test");
    expect(created.env?.AGENT_NAME).toBe("Test Seller");
    expect(created.env?.AGENT_CAPABILITY).toBe("text.translate");
    expect(created.env?.AGENTBAZAAR_URL).toBeTruthy();
    expect(created.env?.EXTRA).toBe("1");

    // Not yet in the list until started? createManagedAgent stores it.
    expect(mh.getManagedAgent(created.id)?.id).toBe(created.id);
    expect(mh.listManagedAgents().length).toBe(1);

    const started = mh.startManagedAgent(created.id);
    expect(started?.status).toBe("running");
    expect(started?.pid).toBeTypeOf("number");
    expect(started?.startedAt).toBeTruthy();

    // Stop kills the process
    const stopped = mh.stopManagedAgent(created.id);
    expect(stopped?.status).toBe("stopped");
    expect(stopped?.stoppedAt).toBeTruthy();

    // Restart spawns again
    const restarted = mh.restartManagedAgent(created.id);
    expect(restarted?.status).toBe("running");
    expect(restarted?.restartCount).toBeGreaterThanOrEqual(0);

    // Remove
    expect(mh.removeManagedAgent(created.id)).toBe(true);
    expect(mh.getManagedAgent(created.id)).toBeNull();
    expect(mh.listManagedAgents().length).toBe(0);
    expect(mh.removeManagedAgent(created.id)).toBe(false);
  });

  it("start on unknown id returns null", async () => {
    const mh = await import("../lib/managed-hosting");
    expect(mh.startManagedAgent("mga_missing")).toBeNull();
    expect(mh.stopManagedAgent("mga_missing")).toBeNull();
    expect(mh.restartManagedAgent("mga_missing")).toBeNull();
  });
});
