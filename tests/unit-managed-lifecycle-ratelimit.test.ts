/**
 * Unit tests for rate limiting on Managed Agent lifecycle routes
 * (start / stop / restart) — Redis-backed V2 limiter wired in.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  startManagedAgent: vi.fn(),
  stopManagedAgent: vi.fn(),
  restartManagedAgent: vi.fn(),
  redisRateLimit: vi.fn(),
}));

vi.mock("@/lib/managed-hosting", () => ({
  startManagedAgent: mocks.startManagedAgent,
  stopManagedAgent: mocks.stopManagedAgent,
  restartManagedAgent: mocks.restartManagedAgent,
}));

vi.mock("@/lib/rate-limit", () => ({
  redisRateLimit: mocks.redisRateLimit,
  clientKey: (req: { headers: { get(n: string): string | null } }) =>
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local",
  rateLimitResponse: (remaining: number) =>
    new Response(
      JSON.stringify({ ok: false, error: "Rate limit exceeded" }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-remaining": String(remaining),
          "retry-after": "60",
        },
      }
    ),
}));

const API_KEY = "test-key-managed-rl";
const fakeManaged = (status: string) => ({
  id: "mga_1",
  name: "Test Agent",
  status,
  pid: 1234,
  port: 4001,
  restartCount: 1,
  stoppedAt: null,
});

let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "managed-rl-test-"));
  process.env.OM_DATA_DIR = tmpDir;
  const { db } = await import("../lib/store");
  db.putAgent({
    id: "agt_rl_owner",
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

function req(url: string, method = "POST") {
  return new NextRequest(url, {
    method,
    headers: { "x-api-key": API_KEY, "x-forwarded-for": "10.0.0.1" },
  });
}

const params = (id = "mga_1") => ({ params: Promise.resolve({ id }) });

describe("managed lifecycle routes — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("start returns 429 when the rate limit is exceeded", async () => {
    mocks.redisRateLimit.mockResolvedValue({ ok: false, remaining: 0 });
    mocks.startManagedAgent.mockReturnValue(fakeManaged("running"));
    const { POST } = await import(
      "../app/api/v1/managed/agents/[id]/start/route"
    );
    const res = await POST(req("http://x/api/v1/managed/agents/mga_1/start"), params());
    expect(res.status).toBe(429);
    expect(res.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(mocks.startManagedAgent).not.toHaveBeenCalled();
  });

  it("start passes through when under the limit", async () => {
    mocks.redisRateLimit.mockResolvedValue({ ok: true, remaining: 19 });
    mocks.startManagedAgent.mockReturnValue(fakeManaged("running"));
    const { POST } = await import(
      "../app/api/v1/managed/agents/[id]/start/route"
    );
    const res = await POST(req("http://x/api/v1/managed/agents/mga_1/start"), params());
    expect(res.status).toBe(200);
    expect(mocks.startManagedAgent).toHaveBeenCalledWith("mga_1");
  });

  it("stop returns 429 when the rate limit is exceeded", async () => {
    mocks.redisRateLimit.mockResolvedValue({ ok: false, remaining: 0 });
    mocks.stopManagedAgent.mockReturnValue({ ...fakeManaged("stopped"), pid: null });
    const { POST } = await import(
      "../app/api/v1/managed/agents/[id]/stop/route"
    );
    const res = await POST(req("http://x/api/v1/managed/agents/mga_1/stop"), params());
    expect(res.status).toBe(429);
    expect(mocks.stopManagedAgent).not.toHaveBeenCalled();
  });

  it("restart returns 429 when the rate limit is exceeded", async () => {
    mocks.redisRateLimit.mockResolvedValue({ ok: false, remaining: 0 });
    mocks.restartManagedAgent.mockReturnValue(fakeManaged("running"));
    const { POST } = await import(
      "../app/api/v1/managed/agents/[id]/restart/route"
    );
    const res = await POST(req("http://x/api/v1/managed/agents/mga_1/restart"), params());
    expect(res.status).toBe(429);
    expect(mocks.restartManagedAgent).not.toHaveBeenCalled();
  });

  it("restart passes through when under the limit", async () => {
    mocks.redisRateLimit.mockResolvedValue({ ok: true, remaining: 19 });
    mocks.restartManagedAgent.mockReturnValue(fakeManaged("running"));
    const { POST } = await import(
      "../app/api/v1/managed/agents/[id]/restart/route"
    );
    const res = await POST(req("http://x/api/v1/managed/agents/mga_1/restart"), params());
    expect(res.status).toBe(200);
    expect(mocks.restartManagedAgent).toHaveBeenCalledWith("mga_1");
  });
});
