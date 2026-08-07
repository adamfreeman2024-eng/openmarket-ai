/**
 * Unit tests for webhook retry — re-delivering failed webhook deliveries
 * with the exact stored payload (owner-only, SSRF-hardened).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let tmpDir: string;

const POLICY = {
  dailySpendLimit: 100,
  maxPerTx: 50,
  allowedCounterparties: [],
  allowedHours: [["00:00", "23:59"]] as [string, string][],
  velocityPerMinute: 0,
  spentToday: 0,
  spentDay: "2026-08-06",
  spentAt: [] as number[],
};

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "webhook-retry-test-"));
  process.env.OM_DATA_DIR = tmpDir;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seedAgent(db: typeof import("../lib/store")["db"], id: string) {
  db.putAgent({
    id,
    name: `Agent ${id}`,
    apiKey: `key-${id}`,
    walletAccountId: "0.0.1111",
    webhookUrl: "https://example.com/hook",
    capabilities: [],
    policy: POLICY,
    stats: { sales: 0, purchases: 0, success: 0, fail: 0, totalLatencyMs: 0 },
    verificationStatus: "bronze",
    createdAt: new Date().toISOString(),
  });
}

describe("webhook retry", () => {
  it("re-delivers stored payload and bumps attempts", async () => {
    const { db } = await import("../lib/store");
    seedAgent(db, "agt_r1");

    db.putWebhookLog({
      id: "whk_retry_1",
      agentId: "agt_r1",
      event: "order_completed",
      url: "https://example.com/hook",
      ok: false,
      status: 500,
      error: "Webhook returned HTTP 500",
      attempts: 1,
      durationMs: 120,
      createdAt: new Date().toISOString(),
      payload: { event: "order_completed", agentId: "agt_r1", orderId: "ord_1" },
    });

    const origFetch = globalThis.fetch;
    let sentBody = "";
    let sentHeaders: Headers | null = null;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      sentBody = String(init?.body || "");
      sentHeaders = (init?.headers as Headers) || null;
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;
    try {
      const { retryWebhookDelivery } = await import("../lib/webhook-retry");
      const res = await retryWebhookDelivery("whk_retry_1", "agt_r1");

      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.log.ok).toBe(true);
      expect(res.log.attempts).toBe(2);
      expect(res.log.error).toBeUndefined();
      // Exact payload re-sent
      const parsed = JSON.parse(sentBody);
      expect(parsed.orderId).toBe("ord_1");
      expect(parsed.agentId).toBe("agt_r1");
      // Retry header present (code sends headers as a plain object — fetch accepts both)
      const headersObj = sentHeaders as Record<string, string> | null;
      expect(headersObj?.["X-OpenMarket-Retry"]).toBe("true");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("records failure when the retry itself fails", async () => {
    const { db } = await import("../lib/store");
    db.putWebhookLog({
      id: "whk_retry_2",
      agentId: "agt_r1",
      event: "order_created",
      url: "https://example.com/hook",
      ok: false,
      status: 500,
      error: "Webhook returned HTTP 500",
      attempts: 2,
      durationMs: 120,
      createdAt: new Date().toISOString(),
      payload: { event: "order_created", agentId: "agt_r1", orderId: "ord_2" },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, status: 503 } as Response)) as typeof fetch;

    try {
      const { retryWebhookDelivery } = await import("../lib/webhook-retry");
      const res = await retryWebhookDelivery("whk_retry_2", "agt_r1");

      expect(res.ok).toBe(true); // retry executed + recorded
      if (!res.ok) return;
      expect(res.log.ok).toBe(false);
      expect(res.log.attempts).toBe(3);
      expect(res.log.error).toContain("HTTP 503");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("denies retry of another agent's delivery", async () => {
    const { db } = await import("../lib/store");
    seedAgent(db, "agt_other");
    db.putWebhookLog({
      id: "whk_retry_3",
      agentId: "agt_other",
      event: "order_completed",
      url: "https://example.com/hook",
      ok: false,
      status: 500,
      attempts: 1,
      durationMs: 10,
      createdAt: new Date().toISOString(),
      payload: { event: "order_completed", agentId: "agt_other" },
    });

    const { retryWebhookDelivery } = await import("../lib/webhook-retry");
    const res = await retryWebhookDelivery("whk_retry_3", "agt_r1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it("returns 404 for unknown log and 400 for missing payload", async () => {
    const { retryWebhookDelivery } = await import("../lib/webhook-retry");

    const missing = await retryWebhookDelivery("whk_nope", "agt_r1");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(404);

    // Log without payload (pre-migration) cannot be retried identically
    const { db } = await import("../lib/store");
    db.putWebhookLog({
      id: "whk_retry_4",
      agentId: "agt_r1",
      event: "order_completed",
      url: "https://example.com/hook",
      ok: false,
      status: 500,
      attempts: 1,
      durationMs: 10,
      createdAt: new Date().toISOString(),
    });
    const noPayload = await retryWebhookDelivery("whk_retry_4", "agt_r1");
    expect(noPayload.ok).toBe(false);
    if (!noPayload.ok) expect(noPayload.status).toBe(400);
  });
});
