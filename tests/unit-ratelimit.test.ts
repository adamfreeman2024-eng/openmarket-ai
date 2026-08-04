import { describe, it, expect, vi } from "vitest";

// Hermetic: disable Redis so tests exercise the deterministic in-memory path.
vi.hoisted(() => {
  process.env.CACHE_ENABLED = "false";
});

import { rateLimit, redisRateLimit, clientKey } from "../lib/rate-limit";

describe("rateLimit (in-memory fallback)", () => {
  it("allows requests under the limit", () => {
    const r1 = rateLimit("test:under", 3, 60_000);
    expect(r1.ok).toBe(true);
    expect(r1.remaining).toBe(2);
    const r2 = rateLimit("test:under", 3, 60_000);
    expect(r2.ok).toBe(true);
    expect(r2.remaining).toBe(1);
  });

  it("blocks when the limit is exceeded", () => {
    rateLimit("test:block", 2, 60_000);
    rateLimit("test:block", 2, 60_000);
    const r3 = rateLimit("test:block", 2, 60_000);
    expect(r3.ok).toBe(false);
    expect(r3.remaining).toBe(0);
  });
});

describe("redisRateLimit", () => {
  it("falls back to in-memory when Redis is not connected", async () => {
    const r1 = await redisRateLimit("test:redis-fallback", 2, 60_000);
    expect(r1.ok).toBe(true);
    const r2 = await redisRateLimit("test:redis-fallback", 2, 60_000);
    expect(r2.ok).toBe(true);
    const r3 = await redisRateLimit("test:redis-fallback", 2, 60_000);
    expect(r3.ok).toBe(false);
  });
});

describe("clientKey", () => {
  it("uses first x-forwarded-for IP", () => {
    const req = {
      headers: {
        get: (n: string) => (n === "x-forwarded-for" ? "1.2.3.4, 5.6.7.8" : null),
      },
    };
    expect(clientKey(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const req = {
      headers: {
        get: (n: string) => (n === "x-real-ip" ? "9.9.9.9" : null),
      },
    };
    expect(clientKey(req)).toBe("9.9.9.9");
  });

  it("defaults to local when no IP headers", () => {
    const req = { headers: { get: () => null } };
    expect(clientKey(req)).toBe("local");
  });
});
