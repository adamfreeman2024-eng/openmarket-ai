/**
 * LLM fulfill metrics + simple circuit stats — Phase 7.2
 * In-process counters exposed via /api/v1/metrics (Prometheus).
 */
export type LlmMetricLabels = {
  provider: string;
  ok: boolean;
};

type Bucket = {
  total: number;
  ok: number;
  err: number;
  latencyMsSum: number;
  lastError?: string;
  lastAt?: string;
};

const byProvider = new Map<string, Bucket>();
let fulfillTotal = 0;
let fulfillOk = 0;
let fulfillErr = 0;
let latencySum = 0;

function bucket(provider: string): Bucket {
  let b = byProvider.get(provider);
  if (!b) {
    b = { total: 0, ok: 0, err: 0, latencyMsSum: 0 };
    byProvider.set(provider, b);
  }
  return b;
}

export function recordLlmFulfill(opts: {
  provider: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}): void {
  const p = opts.provider || "unknown";
  const b = bucket(p);
  b.total += 1;
  fulfillTotal += 1;
  b.latencyMsSum += Math.max(0, opts.latencyMs);
  latencySum += Math.max(0, opts.latencyMs);
  b.lastAt = new Date().toISOString();
  if (opts.ok) {
    b.ok += 1;
    fulfillOk += 1;
  } else {
    b.err += 1;
    fulfillErr += 1;
    if (opts.error) b.lastError = opts.error.slice(0, 200);
  }
}

export function llmMetricsSnapshot(): {
  fulfillTotal: number;
  fulfillOk: number;
  fulfillErr: number;
  avgLatencyMs: number;
  byProvider: Record<
    string,
    { total: number; ok: number; err: number; avgLatencyMs: number; lastError?: string }
  >;
} {
  const by: Record<
    string,
    { total: number; ok: number; err: number; avgLatencyMs: number; lastError?: string }
  > = {};
  for (const [k, v] of byProvider) {
    by[k] = {
      total: v.total,
      ok: v.ok,
      err: v.err,
      avgLatencyMs: v.total ? Math.round(v.latencyMsSum / v.total) : 0,
      lastError: v.lastError,
    };
  }
  return {
    fulfillTotal,
    fulfillOk,
    fulfillErr,
    avgLatencyMs: fulfillTotal ? Math.round(latencySum / fulfillTotal) : 0,
    byProvider: by,
  };
}

/** Prometheus text lines (no trailing newline required). */
export function llmMetricsPrometheus(): string[] {
  const s = llmMetricsSnapshot();
  const lines: string[] = [];
  lines.push("# HELP openmarket_llm_fulfill_total LLM fulfill attempts");
  lines.push("# TYPE openmarket_llm_fulfill_total counter");
  lines.push(`openmarket_llm_fulfill_total ${s.fulfillTotal}`);
  lines.push("# HELP openmarket_llm_fulfill_ok_total Successful LLM fulfills");
  lines.push("# TYPE openmarket_llm_fulfill_ok_total counter");
  lines.push(`openmarket_llm_fulfill_ok_total ${s.fulfillOk}`);
  lines.push("# HELP openmarket_llm_fulfill_err_total Failed LLM fulfills");
  lines.push("# TYPE openmarket_llm_fulfill_err_total counter");
  lines.push(`openmarket_llm_fulfill_err_total ${s.fulfillErr}`);
  lines.push("# HELP openmarket_llm_fulfill_avg_latency_ms Average LLM latency ms");
  lines.push("# TYPE openmarket_llm_fulfill_avg_latency_ms gauge");
  lines.push(`openmarket_llm_fulfill_avg_latency_ms ${s.avgLatencyMs}`);
  lines.push(
    "# HELP openmarket_llm_fulfill_by_provider LLM fulfills by provider and result"
  );
  lines.push("# TYPE openmarket_llm_fulfill_by_provider counter");
  for (const [p, v] of Object.entries(s.byProvider)) {
    const pe = p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    lines.push(
      `openmarket_llm_fulfill_by_provider{provider="${pe}",result="ok"} ${v.ok}`
    );
    lines.push(
      `openmarket_llm_fulfill_by_provider{provider="${pe}",result="err"} ${v.err}`
    );
  }
  return lines;
}
