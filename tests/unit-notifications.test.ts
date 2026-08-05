/**
 * Unit tests for the multi-channel notification system.
 * Verifies title/message formatting and channel routing (webhook/telegram/email).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock store before importing notifications
vi.mock("@/lib/store", () => ({
  db: {
    getAgent: vi.fn(),
    putNotification: vi.fn(),
  },
  newId: vi.fn((prefix: string) => `${prefix}_test`),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { notify } from "../lib/notifications";

describe("notify formatting", () => {
  it("formats order_completed title and message", async () => {
    const { db } = await import("@/lib/store");
    (db.getAgent as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "agt_1",
      name: "TestBot",
      stats: { sales: 0, purchases: 0, success: 0, fail: 0, totalLatencyMs: 0 },
      policy: {},
    });

    await notify.agent("agt_1", "order_completed", { orderId: "ord_123", offerId: "off_1", result: { ok: true } });
    // No throw = success; webhook/telegram/email all no-op without contact fields.
    expect(db.putNotification).toHaveBeenCalledTimes(1);
    const rec = (db.putNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(rec.agentId).toBe("agt_1");
    expect(rec.event).toBe("order_completed");
    expect(rec.read).toBe(false);
    expect(rec.createdAt).toBeTruthy();
    expect(rec.id).toMatch(/^ntf_/);
  });

  it("calls webhook when agent has webhookUrl", async () => {
    const { db } = await import("@/lib/store");
    (db.getAgent as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "agt_2",
      webhookUrl: "https://example.com/hook",
      stats: { sales: 0, purchases: 0, success: 0, fail: 0, totalLatencyMs: 0 },
      policy: {},
    });

    const fetches: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      fetches.push(String(input));
      return { ok: true } as Response;
    }) as typeof fetch;

    try {
      await notify.agent("agt_2", "order_completed", { orderId: "ord_2" });
      expect(fetches.length).toBeGreaterThan(0);
      expect(fetches[0]).toContain("https://example.com/hook");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("does not call telegram without chat id", async () => {
    const { db } = await import("@/lib/store");
    (db.getAgent as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "agt_3",
      stats: { sales: 0, purchases: 0, success: 0, fail: 0, totalLatencyMs: 0 },
      policy: {},
    });

    const fetches: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      fetches.push(String(input));
      return { ok: true } as Response;
    }) as typeof fetch;

    try {
      await notify.agent("agt_3", "escrow_released", { escrowId: "esc_1" });
      expect(fetches.some((f) => f.includes("api.telegram.org"))).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("handles missing agent gracefully", async () => {
    const { db } = await import("@/lib/store");
    (db.getAgent as ReturnType<typeof vi.fn>).mockReturnValue(null);
    await expect(notify.agent("agt_missing", "order_completed", {})).resolves.toBeUndefined();
  });
});
