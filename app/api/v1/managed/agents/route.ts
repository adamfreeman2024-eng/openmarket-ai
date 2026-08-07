import { NextRequest } from "next/server";
import {
  json,
  options,
  requireAgent,
  isResponse,
  readJsonBody,
  rateLimitResponse,
} from "@/lib/http";
import { redisRateLimit, clientKey } from "@/lib/rate-limit";
import {
  createManagedAgent,
  startManagedAgent,
  listManagedAgents,
  managedHostingEnabled,
  healthCheckManagedAgents,
} from "@/lib/managed-hosting";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const ALLOWED_SCRIPT_EXT = [".js", ".cjs", ".mjs"];

function validateScript(script: string): string | null {
  if (!script || typeof script !== "string") return "Missing script path";
  const ext = path.extname(script).toLowerCase();
  if (!ALLOWED_SCRIPT_EXT.includes(ext)) {
    return `Script must be a .js/.cjs/.mjs file (got "${ext || "no extension"}")`;
  }
  const resolved = path.resolve(script);
  if (!fs.existsSync(resolved)) return `Script not found: ${resolved}`;
  return null;
}

function publicManaged(m: {
  id: string;
  name: string;
  agentId: string;
  status: string;
  port?: number;
  script: string;
  startedAt?: string;
  stoppedAt?: string;
  restartCount: number;
  lastError?: string;
}) {
  return {
    id: m.id,
    name: m.name,
    agentId: m.agentId || null,
    status: m.status,
    port: m.port ?? null,
    script: m.script,
    startedAt: m.startedAt ?? null,
    stoppedAt: m.stoppedAt ?? null,
    restartCount: m.restartCount,
    lastError: m.lastError ?? null,
  };
}

/**
 * GET /api/v1/managed/agents — list platform-hosted agents (auth).
 *
 * Headers: X-Api-Key: <agent api key>
 */
export async function GET(req: NextRequest) {
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;
  if (managedHostingEnabled()) {
    healthCheckManagedAgents();
  }
  return json({ ok: true, managed: listManagedAgents().map(publicManaged) });
}

/**
 * POST /api/v1/managed/agents — create + start a platform-hosted agent (auth).
 *
 * Body: { name, script, capability, agentId?, env? }
 * - script: absolute or repo-relative path to a .js/.cjs/.mjs file
 * - env: extra environment variables passed to the spawned process
 * - agentId: optional existing AgentBazaar agent id to link (the script
 *   itself is expected to register via POST /api/v1/agents/register)
 *
 * Gated by MANAGED_HOSTING_ENABLED=true (operator opt-in).
 */
export async function POST(req: NextRequest) {
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  if (!managedHostingEnabled()) {
    return json(
      {
        ok: false,
        error:
          "Managed hosting is disabled — operator must set MANAGED_HOSTING_ENABLED=true",
      },
      403
    );
  }

  const rl = await redisRateLimit(`mga:${clientKey(req)}`, 10, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const bodyRes = await readJsonBody(req);
  if (!bodyRes.ok) return bodyRes.response;
  const body = (bodyRes.data || {}) as Record<string, unknown>;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const script = typeof body.script === "string" ? body.script.trim() : "";
  const capability =
    typeof body.capability === "string" ? body.capability.trim() : "";
  if (!name) return json({ ok: false, error: "Missing name" }, 400);
  if (!capability) return json({ ok: false, error: "Missing capability" }, 400);
  const scriptErr = validateScript(script);
  if (scriptErr) return json({ ok: false, error: scriptErr }, 400);

  const env =
    body.env && typeof body.env === "object" && !Array.isArray(body.env)
      ? (body.env as Record<string, string>)
      : undefined;
  const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";

  const managed = createManagedAgent({
    name,
    script,
    capability,
    env,
    agentId: agentId || undefined,
  });
  const started = startManagedAgent(managed.id);
  const result = started || managed;

  return json(
    { ok: true, managed: publicManaged(result) },
    result.status === "crashed" ? 500 : 201
  );
}
