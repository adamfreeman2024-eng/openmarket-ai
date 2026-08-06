/**
 * Unit tests for webhook delivery logs — durable retry-aware records of
 * outbound webhook attempts (event notifications + fulfillment calls).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "webhook-logs-test-"));
  process.env.OM_DATA_DIR = tmpDir;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("store webhook logs", () => {
  it("put + list + stats roundtrip", async () => {
    const { db } = await import("../lib/store");

    const t = new Date().toISOString();
    db.putWebhookLog({
      id: "whk_1",
      agentId: "agt_a",
      event: "order_completed",
      url: "https://example.com/hook",
      ok: true,
      status: 200,
      attempts: 1,
      durationMs: 42,
      createdAt: t,
    });
    db.putWebhookLog({
      id: "whk_2",
      agentId: "agt_a",
      event: "order_created",
      url: "https://example.com/hook",
      ok: false,
      status: 500,
      error: "Webhook returned HTTP 500",
      attempts: 3,
      durationMs: 120,
      createdAt: new Date(Date.now() + 1000).toISOString(),
    });
    db.putWebhookLog({
      id: "whk_3",
      agentId: "agt_b",
      event: "fulfillment_request",
      url: "https://other.example/hook",
      ok: true,
      status: 200,
      attempts: 1,
      durationMs: 10,
      createdAt: new Date(Date.now() + 2000).toISOString(),
    });

    const all = db.listWebhookLogs();
    expect(all.length).toBe(3);
    // newest first
    expect(all[0].id).toBe("whk_3");

    const mine = db.listWebhookLogs({ agentId: "agt_a" });
    expect(mine.length).toBe(2);

    const stats = db.webhookStats();
    expect(stats.total).toBe(3);
    expect(stats.ok).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.successRate).toBeCloseTo(2 / 3);
    expect(stats.retried).toBe(1);
    expect(stats.recentFailures.length).toBe(1);
    expect(stats.recentFailures[0].id).toBe("whk_2");
  });

  it("caps list limit", async () => {
    const { db } = await import("../lib/store");
    const limited = db.listWebhookLogs({ limit: 2 });
    expect(limited.length).toBe(2);
  });
});

describe("notification webhook logging", () => {
  it("records a delivery log when agent has webhookUrl", async () => {
    const logs: unknown[] = [];
    const { db } = await import("../lib/store");
    const origPut = db.putWebhookLog.bind(db);
    db.putWebhookLog = ((w: unknown) => {
      logs.push(w);
      origPut(w as never);
    }) as typeof db.putWebhookLog;

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, status: 200 } as Response)) as typeof fetch;

    try {
      const { notify } = await import("../lib/notifications");
      // agent must exist in the real store for notify.agent
      db.putAgent({
        id: "agt_wh",
        name: "Webhook Bot",
        apiKey: "key_wh_1",
        walletAccountId: "0.0.9999",
        webhookUrl: "https://example.com/hook",
        capabilities: [],
        policy: POLICY,
        stats: { sales: 0, purchases: 0, success: 0, fail: 0, totalLatencyMs: 0 },
        verificationStatus: "bronze",
        createdAt: new Date().toISOString(),
      });

      await notify.agent("agt_wh", "order_completed", { orderId: "ord_1" });

      expect(logs.length).toBe(1);
      const rec = logs[0] as {
        agentId: string;
        event: string;
        ok: boolean;
        attempts: number;
        durationMs: number;
      };
      expect(rec.agentId).toBe("agt_wh");
      expect(rec.event).toBe("order_completed");
      expect(rec.ok).toBe(true);
      expect(rec.attempts).toBe(1);
      expect(typeof rec.durationMs).toBe("number");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("fulfillment webhook logging", () => {
  it("records ok log with seller agentId on success", async () => {
    const { db } = await import("../lib/store");
    db.putAgent({
      id: "agt_seller",
      name: "Seller Bot",
      apiKey: "key_seller_1",
      walletAccountId: "0.0.1000",
      webhookUrl: "https://example.com/hook",
      capabilities: ["deliver.x"],
      policy: POLICY,
      stats: { sales: 0, purchases: 0, success: 0, fail: 0, totalLatencyMs: 0 },
      verificationStatus: "bronze",
      createdAt: new Date().toISOString(),
    });
    db.putOffer({
      id: "off_x",
      agentId: "agt_seller",
      capability: "deliver.x",
      title: "X",
      description: "x",
      priceAmount: 1,
      priceAsset: "HBAR",
      fulfillmentType: "webhook",
      webhookUrl: "https://example.com/hook",
      maxSeconds: 30,
      escrow: false,
      tags: [],
      active: true,
      createdAt: new Date().toISOString(),
    });

    const before = db.listWebhookLogs({ agentId: "agt_seller" }).length;

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ done: true }),
      } as unknown as Response)) as typeof fetch;

    try {
      const { callWebhookForFulfillment } = await import("../lib/webhook-fulfillment");
      const res = await callWebhookForFulfillment({
        webhookUrl: "https://example.com/hook",
        orderId: "ord_x",
        offerId: "off_x",
        capability: "deliver.x",
      });
      expect(res.ok).toBe(true);
      expect(res.result).toEqual({ done: true });

      const mine = db.listWebhookLogs({ agentId: "agt_seller" });
      expect(mine.length).toBe(before + 1);
      const rec = mine[0];
      expect(rec.event).toBe("fulfillment_request");
      expect(rec.ok).toBe(true);
      expect(rec.url).toBe("https://example.com/hook");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("records failed log on HTTP error", async () => {
    const { db } = await import("../lib/store");
    const before = db.listWebhookLogs({ agentId: "agt_seller" }).length;

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({ ok: false, status: 500 } as Response)) as typeof fetch;

    try {
      const { callWebhookForFulfillment } = await import("../lib/webhook-fulfillment");
      const res = await callWebhookForFulfillment({
        webhookUrl: "https://example.com/hook",
        orderId: "ord_y",
        offerId: "off_x",
        capability: "deliver.x",
      });
      expect(res.ok).toBe(false);

      const mine = db.listWebhookLogs({ agentId: "agt_seller" });
      expect(mine.length).toBe(before + 1);
      expect(mine[0].ok).toBe(false);
      expect(mine[0].error).toContain("HTTP 500");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
