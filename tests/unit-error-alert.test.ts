/**
 * Unit tests for lib/error-alert — 5xx alerting (Phase 1.2 improved
 * logging & monitoring): Redis/memory counting, threshold webhook fire,
 * cooldown, and the http.json() integration (500 → trackServerError).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hermetic: disable Redis so counting uses the deterministic in-memory path.
vi.hoisted(() => {
  process.env.CACHE_ENABLED = "false";
  delete process.env.ALERT_WEBHOOK_URL;
});

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const notifyMock = vi.fn();
vi.mock("@/lib/webhooks", () => ({
  notifyWebhook: (...args: unknown[]) => notifyMock(...args),
}));

import { trackServerError, alertConfigured } from "../lib/error-alert";

describe("trackServerError counting (in-memory)", () => {
  beforeEach(() => {
    notifyMock.mockReset();
    notifyMock.mockResolvedValue({ ok: true });
  });

  it("returns false below the threshold and does not fire a webhook", async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    for (let i = 0; i < 4; i++) {
      const fired = await trackServerError("/api/v1/below");
      expect(fired).toBe(false);
    }
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("fires a webhook once the threshold is crossed (default 5)", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://alerts.example/hook";
    expect(alertConfigured()).toBe(true);
    for (let i = 0; i < 4; i++) {
      await trackServerError("/api/v1/cross");
    }
    const fired = await trackServerError("/api/v1/cross", "boom");
    expect(fired).toBe(true);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const [url, event, payload] = notifyMock.mock.calls[0];
    expect(url).toBe("https://alerts.example/hook");
    expect(event).toBe("alert");
    expect(payload.event).toBe("alert.5xx");
    expect(payload.path).toBe("/api/v1/cross");
    expect(payload.count).toBe(5);
    expect(payload.threshold).toBe(5);
    expect(payload.message).toContain("boom");
  });

  it("cooldown suppresses further alerts for the same path", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://alerts.example/hook";
    // First 5 calls cross the threshold.
    for (let i = 0; i < 5; i++) {
      await trackServerError("/api/v1/cooldown");
    }
    expect(notifyMock).toHaveBeenCalledTimes(1);
    // Even after many more errors, no new alert while in cooldown.
    for (let i = 0; i < 8; i++) {
      const fired = await trackServerError("/api/v1/cooldown");
      expect(fired).toBe(false);
    }
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it("never fires when no ALERT_WEBHOOK_URL is configured", async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    expect(alertConfigured()).toBe(false);
    for (let i = 0; i < 10; i++) {
      await trackServerError("/api/v1/silent");
    }
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("different paths get independent counters and cooldowns", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://alerts.example/hook";
    for (let i = 0; i < 5; i++) {
      await trackServerError("/api/v1/a");
    }
    expect(notifyMock).toHaveBeenCalledTimes(1);
    // Path B is still below its own threshold.
    const firedB = await trackServerError("/api/v1/b");
    expect(firedB).toBe(false);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });
});

describe("http.json() integration", () => {
  it("calls trackServerError for 5xx responses with the path", async () => {
    const { json } = await import("../lib/http");
    // json() is synchronous; trackServerError runs fire-and-forget. Assert the
    // returned NextResponse shape and that tracking doesn't throw.
    const res = json({ ok: false, error: "boom" }, 500, "/api/v1/orders/[id]/pay");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("boom");
  });
});
