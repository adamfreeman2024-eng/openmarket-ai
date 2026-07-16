/**
 * Simple per-IP rate limit for public write endpoints (best-effort, in-memory).
 */
const hits = new Map<string, { n: number; reset: number }>();

export function rateLimit(
  key: string,
  limit = 60,
  windowMs = 60_000
): { ok: boolean; remaining: number } {
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || cur.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  if (cur.n >= limit) return { ok: false, remaining: 0 };
  cur.n += 1;
  return { ok: true, remaining: limit - cur.n };
}

export function clientKey(req: { headers: { get(n: string): string | null } }) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}
