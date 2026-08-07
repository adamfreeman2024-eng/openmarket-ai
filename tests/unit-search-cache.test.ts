/**
 * Unit tests for the Redis cache layer helpers — stable search cache keys
 * (param-order independent) so ?q=x&limit=5 === ?limit=5&q=x share one entry.
 */
import { describe, it, expect, vi } from "vitest";

// Hermetic: disable Redis so tests exercise the deterministic in-memory path.
vi.hoisted(() => {
  process.env.CACHE_ENABLED = "false";
});

import { searchCacheKey, cache } from "../lib/cache";

describe("searchCacheKey", () => {
  it("is stable regardless of param order", () => {
    const a = searchCacheKey("offers:search", new URLSearchParams("q=translate&limit=5&sortBy=reputation"));
    const b = searchCacheKey("offers:search", new URLSearchParams("sortBy=reputation&limit=5&q=translate"));
    expect(a).toBe(b);
    expect(a).toContain("offers:search:");
  });

  it("differentiates different queries", () => {
    const a = searchCacheKey("offers:search", new URLSearchParams("q=translate"));
    const b = searchCacheKey("offers:search", new URLSearchParams("q=code"));
    expect(a).not.toBe(b);
  });

  it("honors the prefix namespace", () => {
    const a = searchCacheKey("offers:search", new URLSearchParams("q=x"));
    const b = searchCacheKey("offers:list", new URLSearchParams("q=x"));
    expect(a).not.toBe(b);
  });
});

describe("cache (in-memory fallback)", () => {
  it("get/set round-trips JSON values", async () => {
    const key = "test:roundtrip";
    await cache.set(key, { ok: true, n: 42 });
    const got = await cache.get<{ ok: boolean; n: number }>(key);
    expect(got).toEqual({ ok: true, n: 42 });
  });

  it("delPattern clears matching keys only", async () => {
    await cache.set("offers:search:a=1", { v: 1 });
    await cache.set("offers:search:b=2", { v: 2 });
    await cache.set("offers:list", { v: 3 });
    await cache.delPattern("offers:search:*");
    expect(await cache.get("offers:search:a=1")).toBeNull();
    expect(await cache.get("offers:search:b=2")).toBeNull();
    expect(await cache.get("offers:list")).toEqual({ v: 3 });
  });
});
