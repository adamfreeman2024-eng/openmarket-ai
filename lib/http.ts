import { NextRequest, NextResponse } from "next/server";
import { db } from "./store";
import type { AgentRecord } from "./types";

const MAX_JSON_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 1_000_000);

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Api-Key, X-Request-Id",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS,DELETE",
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

/** Parse JSON body with size guard (production hardening) */
export async function readJsonBody(
  req: NextRequest
): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse }> {
  const cl = req.headers.get("content-length");
  if (cl && Number(cl) > MAX_JSON_BYTES) {
    return {
      ok: false,
      response: json(
        { ok: false, error: `Body too large (max ${MAX_JSON_BYTES} bytes)` },
        413
      ),
    };
  }
  const text = await req.text().catch(() => "");
  if (text.length > MAX_JSON_BYTES) {
    return {
      ok: false,
      response: json(
        { ok: false, error: `Body too large (max ${MAX_JSON_BYTES} bytes)` },
        413
      ),
    };
  }
  if (!text.trim()) return { ok: true, data: null };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: json({ ok: false, error: "Invalid JSON body" }, 400),
    };
  }
}

export function rateLimitResponse(remaining = 0) {
  return NextResponse.json(
    { ok: false, error: "Rate limit exceeded" },
    {
      status: 429,
      headers: {
        "Retry-After": "60",
        "X-RateLimit-Remaining": String(remaining),
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
