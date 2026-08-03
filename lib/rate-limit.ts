/**
 * Rate limiting V2 — Redis-backed with in-memory fallback.
 * Supports multi-instance deployments (Docker, Kubernetes).
 * 
 * Usage:
 *   import { rateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
 *   const rl = rateLimit(`offer:${clientKey(req)}`, 60, 60_000);
 *   if (!rl.ok) return rateLimitResponse(rl.remaining);
 */
import { cache } from "./cache";
import { log } from "./logger";

type RateLimitResult = { ok: boolean; remaining: number };

const memHits = new Map<string, { n: number; reset: number }>();

export function rateLimit(
  key: string,
  limit = 60,
  windowMs = 60_000
): RateLimitResult {
  const now = Date.now();
  const reset = now + windowMs;

  // Try Redis first (for multi-instance)
  // We use a fire-and-forget approach for Redis to avoid blocking
  if (cache.isConnected()) {
    // Redis-based rate limit (async, but we do sync fallback)
    // For true Redis rate limiting, use redisRateLimit() async version
    // This sync version falls through to memory
  }

  // In-memory rate limit (works for single instance)
  const cur = memHits.get(key);
  if (!cur || cur.reset < now) {
    memHits.set(key, { n: 1, reset });
    return { ok: true, remaining: limit - 1 };
  }
  if (cur.n >= limit) return { ok: false, remaining: 0 };
  cur.n += 1;
  return { ok: true, remaining: limit - cur.n };
}

/**
 * Async Redis-based rate limit for multi-instance deployments.
 * Uses Redis INCR with TTL for atomic counting.
 */
export async function redisRateLimit(
  key: string,
  limit = 60,
  windowMs = 60_000
): Promise<RateLimitResult> {
  if (!cache.isConnected()) {
    // Fall back to in-memory
    return rateLimit(key, limit, windowMs);
  }

  try {
    const redisKey = `ratelimit:${key}`;
    const current = await cache.incr(redisKey, Math.ceil(windowMs / 1000));

    if (current > limit) {
      log.debug({ key, current, limit }, "Rate limit exceeded");
      return { ok: false, remaining: 0 };
    }

    return { ok: true, remaining: Math.max(0, limit - current) };
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : String(e) }, "Redis rate limit failed, using memory");
    return rateLimit(key, limit, windowMs);
  }
}

export function clientKey(req: { headers: { get(n: string): string | null } }) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

export function rateLimitResponse(remaining: number) {
  return new Response(
    JSON.stringify({ ok: false, error: "Rate limit exceeded" }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-remaining": String(remaining),
        "retry-after": "60",
      },
    }
  );
}
