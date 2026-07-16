import { NextRequest, NextResponse } from "next/server";
import { db } from "./store";
import type { AgentRecord } from "./types";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
  });
}

export function options() {
  return json({ ok: true });
}

export function getApiKey(req: NextRequest): string | null {
  const h =
    req.headers.get("x-api-key") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return h?.trim() || null;
}

export function requireAgent(req: NextRequest): AgentRecord | NextResponse {
  const key = getApiKey(req);
  if (!key) return json({ ok: false, error: "Missing X-Api-Key or Bearer" }, 401);
  const agent = db.getAgentByKey(key);
  if (!agent) return json({ ok: false, error: "Invalid API key" }, 401);
  return agent;
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}
