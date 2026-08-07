/**
 * Redis cache layer — improves API response times and reduces DB load.
 * Falls back to in-memory cache if Redis is not available.
 * 
 * Usage:
 *   import { cache } from "@/lib/cache";
 *   const data = await cache.get("offers:list");
 *   await cache.set("offers:list", data, 60); // 60s TTL
 */
import Redis from "ioredis";
import { log } from "./logger";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const ENABLED = process.env.CACHE_ENABLED !== "false";

let redis: Redis | null = null;
let connected = false;

// In-memory fallback
const memCache = new Map<string, { value: string; expiry: number }>();

try {
  if (ENABLED) {
    redis = new Redis(REDIS_URL, {
      retryStrategy: (times) => {
        if (times > 3) {
          log.warn({ redis_url: REDIS_URL }, "Redis unavailable, using in-memory cache");
          return null;
        }
        return Math.min(times * 200, 1000);
      },
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });

    redis.on("connect", () => {
      connected = true;
      log.info("Redis connected");
    });

    redis.on("error", (err) => {
      connected = false;
      log.warn({ err: err.message }, "Redis error, falling back to memory");
    });

    redis.on("close", () => {
      connected = false;
    });
  }
} catch (e) {
  log.warn({ err: e instanceof Error ? e.message : String(e) }, "Redis init failed, using memory cache");
}

/**
 * Stable cache key from URLSearchParams — sorted so param order doesn't matter
 * (e.g. ?q=x&limit=5 === ?limit=5&q=x share one cache entry).
 */
export function searchCacheKey(prefix: string, sp: URLSearchParams): string {
  const entries = [...sp.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return `${prefix}:${entries.map(([k, v]) => `${k}=${v}`).join("&")}`;
}

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    try {
      if (connected && redis) {
        const val = await redis.get(key);
        if (val) return JSON.parse(val) as T;
        return null;
      }
      // Memory fallback
      const mem = memCache.get(key);
      if (mem && mem.expiry > Date.now()) {
        return JSON.parse(mem.value) as T;
      }
      if (mem) memCache.delete(key);
      return null;
    } catch {
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    try {
      const str = JSON.stringify(value);
      if (connected && redis) {
        await redis.setex(key, ttlSeconds, str);
        return;
      }
      // Memory fallback
      memCache.set(key, { value: str, expiry: Date.now() + ttlSeconds * 1000 });
      // Cleanup old entries
      if (memCache.size > 1000) {
        const now = Date.now();
        for (const [k, v] of memCache) {
          if (v.expiry < now) memCache.delete(k);
        }
      }
    } catch (e) {
      log.warn({ err: e instanceof Error ? e.message : String(e) }, "Cache set failed");
    }
  },

  async del(key: string): Promise<void> {
    try {
      if (connected && redis) await redis.del(key);
      memCache.delete(key);
    } catch {
      // ignore
    }
  },

  /**
   * Atomic increment with TTL (Redis INCR + EXPIRE) — used for rate limiting.
   * Falls back to in-memory counter on memory cache when Redis is down.
   * Returns the new counter value.
   */
  async incr(key: string, ttlSeconds = 60): Promise<number> {
    try {
      if (connected && redis) {
        const val = await redis.incr(key);
        if (val === 1) await redis.expire(key, ttlSeconds);
        return val;
      }
      // Memory fallback
      const mem = memCache.get(key);
      if (!mem || mem.expiry <= Date.now()) {
        const entry = { value: "1", expiry: Date.now() + ttlSeconds * 1000 };
        memCache.set(key, entry);
        return 1;
      }
      const next = (JSON.parse(mem.value) as number) + 1;
      mem.value = String(next);
      return next;
    } catch {
      // If Redis just died, approximate with memory
      const mem = memCache.get(key);
      if (!mem || mem.expiry <= Date.now()) {
        memCache.set(key, { value: "1", expiry: Date.now() + ttlSeconds * 1000 });
        return 1;
      }
      const next = (JSON.parse(mem.value) as number) + 1;
      mem.value = String(next);
      return next;
    }
  },

  async delPattern(pattern: string): Promise<void> {
    try {
      if (connected && redis) {
        const keys = await redis.keys(pattern);
        if (keys.length) await redis.del(...keys);
      }
      // Memory fallback
      for (const k of memCache.keys()) {
        if (k.includes(pattern.replace("*", ""))) memCache.delete(k);
      }
    } catch {
      // ignore
    }
  },

  isRedis(): boolean {
    return connected;
  },

  isConnected(): boolean {
    return connected;
  },
};
