/**
 * SLA badge formatting for catalog/search UI (Task 3.2).
 * Pure helpers — unit-testable without React/Next.
 */

export type CatalogSla = {
  onTimeRate: number; // 0..1
  totalDeliveries: number;
  avgLatencyMs: number;
};

/**
 * Human-readable SLA badge for an offer card.
 * Returns null when there is no delivery history (never imply quality
 * that hasn't been earned).
 */
export function slaBadge(sla?: CatalogSla | null): string | null {
  if (!sla || sla.totalDeliveries <= 0) return null;
  const pct = Math.round(sla.onTimeRate * 100);
  if (sla.avgLatencyMs > 0) {
    const secs = sla.avgLatencyMs / 1000;
    const lat = secs >= 10 ? `${Math.round(secs)}s` : `${secs.toFixed(1)}s`;
    return `SLA ${pct}% · ${lat}`;
  }
  return `SLA ${pct}%`;
}

/** Short latency label, e.g. 1234 → "1.2s", 400 → "400ms". */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const secs = ms / 1000;
  return secs >= 10 ? `${Math.round(secs)}s` : `${secs.toFixed(1)}s`;
}
