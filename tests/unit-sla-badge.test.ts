import { describe, it, expect } from "vitest";
import { slaBadge, formatLatency } from "../lib/sla-badge";

describe("slaBadge", () => {
  it("returns null for no history (never imply unearned quality)", () => {
    expect(slaBadge(undefined)).toBeNull();
    expect(slaBadge(null)).toBeNull();
    expect(slaBadge({ onTimeRate: 0.9, totalDeliveries: 0, avgLatencyMs: 500 })).toBeNull();
  });

  it("formats SLA percentage with latency", () => {
    const badge = slaBadge({ onTimeRate: 0.95, totalDeliveries: 20, avgLatencyMs: 1200 });
    expect(badge).toBe("SLA 95% · 1.2s");
  });

  it("omits latency when there is none", () => {
    const badge = slaBadge({ onTimeRate: 1, totalDeliveries: 3, avgLatencyMs: 0 });
    expect(badge).toBe("SLA 100%");
  });

  it("rounds percentage", () => {
    expect(slaBadge({ onTimeRate: 0.666, totalDeliveries: 9, avgLatencyMs: 0 })).toBe("SLA 67%");
  });
});

describe("formatLatency", () => {
  it("formats ms under a second", () => {
    expect(formatLatency(400)).toBe("400ms");
  });

  it("formats seconds with one decimal", () => {
    expect(formatLatency(1234)).toBe("1.2s");
  });

  it("formats >= 10s without decimal", () => {
    expect(formatLatency(10500)).toBe("11s");
  });

  it("returns empty for invalid input", () => {
    expect(formatLatency(0)).toBe("");
    expect(formatLatency(NaN)).toBe("");
    expect(formatLatency(-5)).toBe("");
  });
});
