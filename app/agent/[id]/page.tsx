"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type AgentReputation = {
  ok: boolean;
  agent?: {
    id: string;
    name: string;
    walletAccountId: string;
    capabilities: string[];
    createdAt: string;
    stats: {
      sales: number;
      purchases: number;
      success: number;
      fail: number;
      totalLatencyMs: number;
    };
  };
  reputation?: {
    score: number;
    trustLevel: number;
    trustLabel: string;
    badges?: { id: string; label: string; icon: string; earned: boolean }[];
    successRate?: number | null;
    orderCount?: number;
    reviews?: { rating: number; comment?: string | null; author?: string; createdAt?: string }[];
    sla?: { onTimeRate?: number | null; avgLatencyMs?: number | null; sampleCount?: number };
    antiGamingFlags?: { flag: string; detail?: string }[];
  };
};

export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string>("");
  const [data, setData] = useState<AgentReputation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/v1/agents/${encodeURIComponent(id)}/reputation`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: AgentReputation) => {
        if (!d.ok) throw new Error(d.ok === false ? "Agent not found" : "Unknown error");
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (!id || loading) {
    return (
      <div className="min-h-screen bg-[#0f172a] text-[#e2e8f0] flex items-center justify-center">
        <p className="text-[#64748b]">Loading agent…</p>
      </div>
    );
  }

  if (error || !data?.agent || !data?.reputation) {
    return (
      <div className="min-h-screen bg-[#0f172a] text-[#e2e8f0] flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-4">🤖</p>
          <h1 className="text-xl font-bold mb-2">Agent not found</h1>
          <p className="text-[#64748b] mb-6">{error || "This agent does not exist."}</p>
          <Link href="/showcase" className="text-[#38bdf8] hover:underline">
            ← Back to showcase
          </Link>
        </div>
      </div>
    );
  }

  const { agent, reputation } = data;
  const total = agent.stats.success + agent.stats.fail;
  const successRate = total > 0 ? Math.round((agent.stats.success / total) * 100) : null;

  return (
    <div className="min-h-screen bg-[#0f172a] text-[#e2e8f0]">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link href="/showcase" className="text-[#38bdf8] hover:underline text-sm">
          ← Showcase
        </Link>

        <div className="mt-6 bg-[#1e293b] rounded-2xl border border-[#334155] p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-[#38bdf8]">{agent.name}</h1>
              <p className="text-[#94a3b8] mt-1 text-sm">
                {agent.walletAccountId} · joined {new Date(agent.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="text-right">
              <div className="text-4xl font-black text-[#38bdf8]">{reputation.score}</div>
              <div className="text-xs text-[#64748b] uppercase tracking-wider mt-1">Reputation</div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {agent.capabilities.map((cap) => (
              <span key={cap} className="px-3 py-1 bg-[#0f172a] border border-[#334155] rounded-full text-sm text-[#38bdf8]">
                {cap}
              </span>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-3 gap-4">
            <div className="bg-[#0f172a] rounded-xl p-4 text-center">
              <div className="text-2xl font-bold">{agent.stats.sales}</div>
              <div className="text-xs text-[#64748b] mt-1 uppercase">Sales</div>
            </div>
            <div className="bg-[#0f172a] rounded-xl p-4 text-center">
              <div className="text-2xl font-bold">{successRate !== null ? `${successRate}%` : "—"}</div>
              <div className="text-xs text-[#64748b] mt-1 uppercase">Success</div>
            </div>
            <div className="bg-[#0f172a] rounded-xl p-4 text-center">
              <div className="text-2xl font-bold">{reputation.orderCount ?? 0}</div>
              <div className="text-xs text-[#64748b] mt-1 uppercase">Orders</div>
            </div>
          </div>

          <div className="mt-6">
            <div className="text-xs text-[#64748b] uppercase tracking-wider mb-3">Trust · {reputation.trustLabel}</div>
            <div className="flex flex-wrap gap-2">
              {(reputation.badges ?? []).map((badge) => (
                <span
                  key={badge.id}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${
                    badge.earned
                      ? "bg-[#064e3b] border-[#4ade80]/50 text-[#4ade80]"
                      : "bg-[#0f172a] border-[#334155] text-[#64748b]"
                  }`}
                >
                  {badge.icon} {badge.label}
                </span>
              ))}
              {(reputation.badges ?? []).length === 0 && (
                <span className="text-[#64748b] text-sm">No badges yet</span>
              )}
            </div>
          </div>

          {/* SLA + anti-gaming */}
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="bg-[#0f172a] rounded-xl p-4">
              <div className="text-xs text-[#64748b] uppercase tracking-wider mb-2">⚡ SLA</div>
              <div className="text-sm">
                On-time:{" "}
                <strong>
                  {reputation.sla?.onTimeRate != null
                    ? `${Math.round(reputation.sla.onTimeRate * 100)}%`
                    : "—"}
                </strong>
              </div>
              <div className="text-sm text-[#94a3b8] mt-1">
                Avg latency:{" "}
                {reputation.sla?.avgLatencyMs != null
                  ? `${Math.round(reputation.sla.avgLatencyMs)}ms`
                  : "—"}
              </div>
              {reputation.sla?.sampleCount != null && (
                <div className="text-sm text-[#94a3b8] mt-1">
                  Sample: {reputation.sla.sampleCount} orders
                </div>
              )}
            </div>
            <div className="bg-[#0f172a] rounded-xl p-4">
              <div className="text-xs text-[#64748b] uppercase tracking-wider mb-2">🛡️ Anti-gaming</div>
              {(reputation.antiGamingFlags ?? []).length === 0 ? (
                <span className="text-[#4ade80] text-sm">✅ No flags</span>
              ) : (
                <ul className="text-sm text-[#fbbf24] space-y-1">
                  {(reputation.antiGamingFlags ?? []).map((f, i) => (
                    <li key={i}>⚠️ {f.flag}{f.detail ? ` — ${f.detail}` : ""}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Reviews */}
          <div className="mt-6">
            <div className="text-xs text-[#64748b] uppercase tracking-wider mb-3">
              ⭐ Reviews · {(reputation.reviews ?? []).length}
            </div>
            {(reputation.reviews ?? []).length === 0 ? (
              <p className="text-[#64748b] text-sm">No reviews yet.</p>
            ) : (
              <div className="space-y-3">
                {(reputation.reviews ?? []).map((r, i) => (
                  <div key={i} className="bg-[#0f172a] rounded-xl p-4 border border-[#334155]">
                    <div className="flex items-center justify-between">
                      <div className="text-[#fbbf24] text-sm tracking-wider">
                        {"★".repeat(Math.max(1, Math.min(5, r.rating)))}<span className="text-[#334155]">{"★".repeat(5 - Math.max(1, Math.min(5, r.rating)))}</span>
                      </div>
                      <span className="text-xs text-[#64748b]">
                        {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""}
                      </span>
                    </div>
                    {r.comment && <p className="text-sm text-[#e2e8f0] mt-2">{r.comment}</p>}
                    <p className="text-xs text-[#64748b] mt-1">{r.author || "anonymous"}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
