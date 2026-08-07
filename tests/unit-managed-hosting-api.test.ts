/**
 * Unit tests for the Managed Agent Hosting API routes — auth, gate,
 * validation, and lifecycle endpoints (managed-hosting lib mocked).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createManagedAgent: vi.fn(),
  startManagedAgent: vi.fn(),
  stopManagedAgent: vi.fn(),
  restartManagedAgent: vi.fn(),
  getManagedAgent: vi.fn(),
  listManagedAgents: vi.fn(),
  removeManagedAgent: vi.fn(),
  managedHostingEnabled: vi.fn(),
}));

vi.mock("@/lib/managed-hosting", () => mocks);

let tmpDir: string;
const API_KEY = "test-key-managed-1";

const fakeManaged = (overrides: Record<string, unknown> = {}) => ({
  id: "mga_1",
  name: "Test Agent",
  agentId: "agt_1",
  status: "running",
  port: 4001,
  script: "/tmp/agent.js",
  restartCount: 0,
  startedAt: "2026-08-07T00:00:00.000Z",
  stoppedAt: null,
  lastError: null,
  ...overrides,
});

function req(
  url: string,
  opts: { method?: string; key?: string | null; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (opts.key) headers["x-api-key"] = opts.key;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "managed-api-test-"));
  process.env.OM_DATA_DIR = tmpDir;
  const { db } = await import("../lib/store");
  db.putAgent({
    id: "agt_owner",
    name: "Owner",
    apiKey: API_KEY,
    walletAccountId: "0.0.9999",
    capabilities: [],
    policy: {
      dailySpendLimit: 100,
      maxPerTx: 50,
      allowedCounterparties: [],
      allowedHours: [],
      velocityPerMinute: 0,
      spentToday: 0,
      spentDay: "2026-08-07",
      spentAt: [],
    },
    stats: { sales: 0, purchases: 0, success: 0, fail: 0, totalLatencyMs: 0 },
    verificationStatus: "bronze",
    createdAt: new Date().toISOString(),
  });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.managedHostingEnabled.mockReturnValue(false);
  mocks.listManagedAgents.mockReturnValue([fakeManaged()]);
  mocks.getManagedAgent.mockReturnValue(fakeManaged());
});

describe("GET /api/v1/managed/agents", () => {
  it("requires auth", async () => {
    const { GET } = await import("../app/api/v1/managed/agents/route");
    const res = await GET(req("http://x/api/v1/managed/agents"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("lists managed agents for an authenticated agent", async () => {
    const { GET } = await import("../app/api/v1/managed/agents/route");
    const res = await GET(
      req("http://x/api/v1/managed/agents", { key: API_KEY })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.managed).toHaveLength(1);
    expect(body.managed[0].id).toBe("mga_1");
    expect(body.managed[0].agentId).toBe("agt_1");
  });
});

describe("POST /api/v1/managed/agents", () => {
  it("requires auth", async () => {
    const { POST } = await import("../app/api/v1/managed/agents/route");
    const res = await POST(
      req("http://x/api/v1/managed/agents", {
        method: "POST",
        body: { name: "A", script: "/tmp/a.js", capability: "x" },
      })
    );
    expect(res.status).toBe(401);
  });

  it("rejects when managed hosting is disabled", async () => {
    const { POST } = await import("../app/api/v1/managed/agents/route");
    const res = await POST(
      req("http://x/api/v1/managed/agents", {
        method: "POST",
        key: API_KEY,
        body: { name: "A", script: "/tmp/a.js", capability: "x" },
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("MANAGED_HOSTING_ENABLED");
  });

  it("validates body fields", async () => {
    mocks.managedHostingEnabled.mockReturnValue(true);
    const { POST } = await import("../app/api/v1/managed/agents/route");

    const noName = await POST(
      req("http://x/api/v1/managed/agents", {
        method: "POST",
        key: API_KEY,
        body: { script: "/tmp/a.js", capability: "x" },
      })
    );
    expect(noName.status).toBe(400);

    const noCap = await POST(
      req("http://x/api/v1/managed/agents", {
        method: "POST",
        key: API_KEY,
        body: { name: "A", script: "/tmp/a.js" },
      })
    );
    expect(noCap.status).toBe(400);

    const badExt = await POST(
      req("http://x/api/v1/managed/agents", {
        method: "POST",
        key: API_KEY,
        body: { name: "A", script: "/tmp/a.sh", capability: "x" },
      })
    );
    expect(badExt.status).toBe(400);
    expect((await badExt.json()).error).toContain(".js/.cjs/.mjs");

    const missingFile = await POST(
      req("http://x/api/v1/managed/agents", {
        method: "POST",
        key: API_KEY,
        body: { name: "A", script: "/tmp/does-not-exist.js", capability: "x" },
      })
    );
    expect(missingFile.status).toBe(400);
    expect((await missingFile.json()).error).toContain("Script not found");
  });

  it("creates and starts a managed agent", async () => {
    mocks.managedHostingEnabled.mockReturnValue(true);
    mocks.createManagedAgent.mockReturnValue(fakeManaged());
    mocks.startManagedAgent.mockReturnValue(fakeManaged());

    // Route validates the script file exists on disk.
    const agentScript = path.join(tmpDir, "agent.js");
    fs.writeFileSync(agentScript, "console.log('up');");

    const { POST } = await import("../app/api/v1/managed/agents/route");
    const res = await POST(
      req("http://x/api/v1/managed/agents", {
        method: "POST",
        key: API_KEY,
        body: {
          name: "Test Agent",
          script: agentScript,
          capability: "text.translate",
          agentId: "agt_1",
          env: { FOO: "bar" },
        },
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.managed.id).toBe("mga_1");
    expect(body.managed.status).toBe("running");
    expect(mocks.createManagedAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Test Agent",
        script: agentScript,
        capability: "text.translate",
        agentId: "agt_1",
        env: { FOO: "bar" },
      })
    );
    expect(mocks.startManagedAgent).toHaveBeenCalledWith("mga_1");
  });
});

describe("GET/DELETE /api/v1/managed/agents/:id", () => {
  it("returns 404 for unknown id", async () => {
    mocks.getManagedAgent.mockReturnValue(null);
    mocks.removeManagedAgent.mockReturnValue(false);
    const { GET, DELETE } = await import(
      "../app/api/v1/managed/agents/[id]/route"
    );
    const res = await GET(
      req("http://x/api/v1/managed/agents/mga_x", { key: API_KEY }),
      params("mga_x")
    );
    expect(res.status).toBe(404);
    const del = await DELETE(
      req("http://x/api/v1/managed/agents/mga_x", {
        method: "DELETE",
        key: API_KEY,
      }),
      params("mga_x")
    );
    expect(del.status).toBe(404);
  });

  it("requires auth on DELETE", async () => {
    const { DELETE } = await import(
      "../app/api/v1/managed/agents/[id]/route"
    );
    const res = await DELETE(
      req("http://x/api/v1/managed/agents/mga_1", { method: "DELETE" }),
      params("mga_1")
    );
    expect(res.status).toBe(401);
  });

  it("removes a managed agent", async () => {
    mocks.removeManagedAgent.mockReturnValue(true);
    const { DELETE } = await import(
      "../app/api/v1/managed/agents/[id]/route"
    );
    const res = await DELETE(
      req("http://x/api/v1/managed/agents/mga_1", {
        method: "DELETE",
        key: API_KEY,
      }),
      params("mga_1")
    );
    expect(res.status).toBe(200);
    expect((await res.json()).removed).toBe("mga_1");
  });
});

describe("start/stop/restart sub-routes", () => {
  it("starts, stops, restarts", async () => {
    mocks.startManagedAgent.mockReturnValue(fakeManaged());
    mocks.stopManagedAgent.mockReturnValue(fakeManaged({ status: "stopped" }));
    mocks.restartManagedAgent.mockReturnValue(fakeManaged());

    const { POST: startPost } = await import(
      "../app/api/v1/managed/agents/[id]/start/route"
    );
    const s = await startPost(
      req("http://x/api/v1/managed/agents/mga_1/start", {
        method: "POST",
        key: API_KEY,
      }),
      params("mga_1")
    );
    expect(s.status).toBe(200);
    expect((await s.json()).managed.status).toBe("running");

    const { POST: stopPost } = await import(
      "../app/api/v1/managed/agents/[id]/stop/route"
    );
    const st = await stopPost(
      req("http://x/api/v1/managed/agents/mga_1/stop", {
        method: "POST",
        key: API_KEY,
      }),
      params("mga_1")
    );
    expect(st.status).toBe(200);
    expect((await st.json()).managed.status).toBe("stopped");

    const { POST: restartPost } = await import(
      "../app/api/v1/managed/agents/[id]/restart/route"
    );
    const r = await restartPost(
      req("http://x/api/v1/managed/agents/mga_1/restart", {
        method: "POST",
        key: API_KEY,
      }),
      params("mga_1")
    );
    expect(r.status).toBe(200);
    expect(mocks.restartManagedAgent).toHaveBeenCalledWith("mga_1");
  });

  it("returns 404 on unknown id", async () => {
    mocks.startManagedAgent.mockReturnValue(null);
    const { POST } = await import(
      "../app/api/v1/managed/agents/[id]/start/route"
    );
    const res = await POST(
      req("http://x/api/v1/managed/agents/mga_x/start", {
        method: "POST",
        key: API_KEY,
      }),
      params("mga_x")
    );
    expect(res.status).toBe(404);
  });
});
