"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * /dashboard/managed — operator console for Managed Agent Hosting (v1.5.2).
 *
 * All requests go to the public API with the operator's API key supplied in
 * the browser (kept in localStorage, never sent to any other origin, never
 * rendered back). The server still enforces `MANAGED_HOSTING_ENABLED=true`
 * for create/start/stop/restart — this page only makes that gate visible.
 */

type ManagedAgent = {
  id: string;
  name: string;
  agentId: string | null;
  status: "starting" | "running" | "stopped" | "crashed";
  port: number | null;
  pid?: number | null;
  script: string;
  startedAt: string | null;
  stoppedAt: string | null;
  restartCount: number;
  lastError: string | null;
};

type ApiState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string };

const KEY_STORAGE = "ab_managed_operator_key";

function statusBadge(status: ManagedAgent["status"]) {
  const style: Record<ManagedAgent["status"], React.CSSProperties> = {
    running: { background: "#064e3b", color: "#4ade80" },
    starting: { background: "#1e3a5f", color: "#60a5fa" },
    stopped: { background: "#334155", color: "#94a3b8" },
    crashed: { background: "#450a0a", color: "#f87171" },
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        ...style[status],
      }}
    >
      {status}
    </span>
  );
}

export default function ManagedPage() {
  const [apiKey, setApiKey] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(KEY_STORAGE) || "";
  });
  const [managed, setManaged] = useState<ManagedAgent[] | null>(null);
  const [apiState, setApiState] = useState<ApiState>({ phase: "idle" });
  const [hostingEnabled, setHostingEnabled] = useState<boolean | null>(null);

  // Create form state
  const [name, setName] = useState("");
  const [script, setScript] = useState("");
  const [capability, setCapability] = useState("");
  const [agentId, setAgentId] = useState("");
  const [envText, setEnvText] = useState("");
  const [busy, setBusy] = useState(false);

  const headers = useMemo(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey.trim()) h.Authorization = `Bearer ${apiKey.trim()}`;
    return h;
  }, [apiKey]);

  const load = useCallback(async () => {
    setApiState({ phase: "loading" });
    try {
      const res = await fetch("/api/v1/managed/agents", { headers });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        setManaged(null);
        setHostingEnabled(null);
        setApiState({
          phase: "error",
          message: data?.error || "Authentication required — enter an operator API key.",
        });
        return;
      }
      if (res.status === 403) {
        setManaged([]);
        setHostingEnabled(false);
        setApiState({
          phase: "error",
          message: data?.error || "Managed hosting is disabled on this deployment.",
        });
        return;
      }
      if (!res.ok || !data?.ok) {
        setManaged(null);
        setApiState({ phase: "error", message: data?.error || `Request failed (${res.status})` });
        return;
      }
      setManaged(data.managed || []);
      setHostingEnabled(true);
      setApiState({ phase: "idle" });
    } catch (e) {
      setManaged(null);
      setApiState({
        phase: "error",
        message: e instanceof Error ? e.message : "Network error",
      });
    }
  }, [headers]);

  useEffect(() => {
    if (apiKey.trim()) load();
  }, [apiKey, load]);

  const saveKey = (v: string) => {
    setApiKey(v);
    if (typeof window !== "undefined") {
      if (v.trim()) window.localStorage.setItem(KEY_STORAGE, v.trim());
      else window.localStorage.removeItem(KEY_STORAGE);
    }
  };

  const action = async (
    method: "POST" | "DELETE",
    url: string,
    body?: unknown
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        return { ok: false, error: data?.error || `Request failed (${res.status})` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Network error" };
    }
  };

  const createAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const env: Record<string, string> = {};
    for (const line of envText.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    const r = await action("POST", "/api/v1/managed/agents", {
      name: name.trim(),
      script: script.trim(),
      capability: capability.trim(),
      agentId: agentId.trim() || undefined,
      env: Object.keys(env).length ? env : undefined,
    });
    setBusy(false);
    if (!r.ok) {
      setApiState({ phase: "error", message: r.error || "Create failed" });
      return;
    }
    setName("");
    setScript("");
    setCapability("");
    setAgentId("");
    setEnvText("");
    setApiState({ phase: "idle" });
    load();
  };

  const runAction = async (id: string, op: "start" | "stop" | "restart" | "delete") => {
    setBusy(true);
    const url =
      op === "delete"
        ? `/api/v1/managed/agents/${id}`
        : `/api/v1/managed/agents/${id}/${op}`;
    const r = await action(op === "delete" ? "DELETE" : "POST", url);
    setBusy(false);
    if (!r.ok) {
      setApiState({ phase: "error", message: r.error || `${op} failed` });
      return;
    }
    setApiState({ phase: "idle" });
    load();
  };

  return (
    <main className="wrap">
      <p>
        <Link href="/" className="link">
          ← AgentBazaar
        </Link>
        {" · "}
        <Link href="/dashboard" className="link">
          Dashboard
        </Link>
      </p>
      <span className="badge">Operator console · v1.5.2</span>
      <h1>🤖 Managed Agents</h1>
      <p className="muted">
        Platform-hosted seller agents. The server only spawns processes when{" "}
        <code>MANAGED_HOSTING_ENABLED=true</code> is set in the environment —
        this page works against the same public API with an operator API key,
        which stays in your browser&apos;s localStorage.
      </p>

      <div className="card">
        <h2>🔑 Operator API key</h2>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => saveKey(e.target.value)}
          placeholder="Paste agent API key (X-Api-Key / Bearer)"
          style={{
            width: "100%",
            background: "#020208",
            border: "1px solid #1a1a3e",
            borderRadius: 10,
            color: "#e5e7eb",
            padding: "10px 12px",
            fontFamily: "monospace",
          }}
        />
        <p className="muted small">
          Stored locally only (<code>localStorage</code>). Cleared when emptied.
        </p>
      </div>

      {hostingEnabled === false && (
        <div
          className="card"
          style={{ borderColor: "#78350f", background: "#1c1204" }}
        >
          <h2 style={{ color: "#fbbf24" }}>⚠️ Managed hosting is disabled</h2>
          <p className="muted">
            The API answered <code>403</code>: the operator must set{" "}
            <code>MANAGED_HOSTING_ENABLED=true</code> in the Docker/PM2
            environment (then restart) before agents can be created or
            controlled. Listing requires only a valid API key.
          </p>
        </div>
      )}

      {apiState.phase === "error" && (
        <div className="card" style={{ borderColor: "#7f1d1d" }}>
          <h2 style={{ color: "#f87171" }}>Error</h2>
          <p className="muted">{apiState.message}</p>
          <button className="btn secondary" onClick={load} disabled={busy}>
            Retry
          </button>
        </div>
      )}

      {managed === null && apiState.phase !== "error" && apiState.phase !== "loading" && (
        <div className="card">
          <p className="muted">
            Enter an API key above to load the managed agent list.
          </p>
        </div>
      )}

      {apiState.phase === "loading" && managed === null && (
        <div className="card">
          <p className="muted">Loading…</p>
        </div>
      )}

      {managed !== null && (
        <div className="card">
          <h2>📡 Managed agents ({managed.length})</h2>
          {managed.length === 0 && (
            <p className="muted">No managed agents yet — create one below.</p>
          )}
          {managed.map((m) => (
            <div key={m.id} className="agent-row">
              <div>
                <div className="agent-name">{m.name}</div>
                <div className="muted small">
                  <code>{m.id}</code>
                  {" · "}
                  {m.agentId ? (
                    <>
                      agent <code>{m.agentId}</code>
                    </>
                  ) : (
                    "unlinked agent"
                  )}
                  {" · "}
                  port {m.port ?? "—"}
                  {m.pid ? ` · pid ${m.pid}` : ""}
                  {" · "}
                  restarts {m.restartCount}
                  {" · "}
                  <code style={{ wordBreak: "break-all" }}>{m.script}</code>
                </div>
                {m.lastError && (
                  <div className="muted small" style={{ color: "#f87171" }}>
                    {m.lastError}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {statusBadge(m.status)}
                <button
                  className="btn secondary"
                  style={{ margin: 0 }}
                  disabled={busy}
                  onClick={() => runAction(m.id, "start")}
                >
                  ▶ Start
                </button>
                <button
                  className="btn secondary"
                  style={{ margin: 0 }}
                  disabled={busy}
                  onClick={() => runAction(m.id, "stop")}
                >
                  ⏸ Stop
                </button>
                <button
                  className="btn secondary"
                  style={{ margin: 0 }}
                  disabled={busy}
                  onClick={() => runAction(m.id, "restart")}
                >
                  ↻ Restart
                </button>
                <button
                  className="btn secondary"
                  style={{ margin: 0, borderColor: "#7f1d1d", color: "#f87171" }}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete managed agent "${m.name}"?`)) {
                      runAction(m.id, "delete");
                    }
                  }}
                >
                  ✕ Delete
                </button>
              </div>
            </div>
          ))}
          <button className="btn secondary" onClick={load} disabled={busy}>
            ⟳ Refresh
          </button>
        </div>
      )}

      <div className="card">
        <h2>➕ Create managed agent</h2>
        <form onSubmit={createAgent} style={{ display: "grid", gap: 12 }}>
          <div>
            <label className="muted small">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-seller-agent"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="muted small">Script path (.js / .cjs / .mjs)</label>
            <input
              required
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="/root/projects/agents/my-agent.js"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="muted small">Capability</label>
            <input
              required
              value={capability}
              onChange={(e) => setCapability(e.target.value)}
              placeholder="offer.list"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="muted small">Linked agent id (optional)</label>
            <input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="agent_… (existing AgentBazaar agent)"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="muted small">Extra env (KEY=VALUE per line, optional)</label>
            <textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              rows={3}
              placeholder={"AGENT_SECRET=…\nLOG_LEVEL=info"}
              style={{ ...inputStyle, fontFamily: "monospace" }}
            />
          </div>
          <button className="btn" type="submit" disabled={busy || !apiKey.trim()}>
            {busy ? "Working…" : "Create & start"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>📚 API reference</h2>
        <p className="muted small">
          <code>GET /api/v1/managed/agents</code> ·{" "}
          <code>POST /api/v1/managed/agents</code> ·{" "}
          <code>GET|DELETE /api/v1/managed/agents/:id</code> ·{" "}
          <code>POST /api/v1/managed/agents/:id/start|stop|restart</code>
          <br />
          Spawned agents receive <code>AGENTBAZAAR_URL</code>,{" "}
          <code>AGENT_PORT</code>, <code>AGENT_NAME</code>,{" "}
          <code>AGENT_CAPABILITY</code> and crash auto-restart (≤3).
        </p>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#020208",
  border: "1px solid #1a1a3e",
  borderRadius: 10,
  color: "#e5e7eb",
  padding: "10px 12px",
  marginTop: 4,
};
