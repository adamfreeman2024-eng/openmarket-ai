"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type WorkflowNodeData = {
  label: string;
  capability: string;
  input?: Record<string, unknown>;
};

const CAPABILITIES = [
  "text.summarize",
  "text.translate",
  "text.reply",
  "agent.answer",
  "code.review",
  "text.sentiment",
  "text.classify",
  "text.extract",
  "legal.tos_audit",
  "security.smart_contract_audit",
];

const COLORS: Record<string, string> = {
  text: "#3b82f6",
  agent: "#8b5cf6",
  code: "#10b981",
  legal: "#f59e0b",
  security: "#ef4444",
};

function colorFor(cap: string) {
  for (const k of Object.keys(COLORS)) if (cap.startsWith(k)) return COLORS[k];
  return "#64748b";
}

function FlowNode({ data }: NodeProps) {
  const d = data as WorkflowNodeData;
  return (
    <div
      style={{
        border: `2px solid ${colorFor(d.capability)}`,
        borderRadius: 10,
        background: "#0f172a",
        color: "#e2e8f0",
        padding: "10px 14px",
        minWidth: 180,
        fontFamily: "inherit",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700 }}>{d.label}</div>
      <div style={{ fontSize: 11, opacity: 0.7, fontFamily: "monospace" }}>
        {d.capability}
      </div>
    </div>
  );
}

const nodeTypes = { wf: FlowNode };

export default function WorkflowsPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("My Workflow");
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge(c, eds)),
    [setEdges]
  );

  const addNode = useCallback(
    (capability: string) => {
      const id = `${capability.replace(/[^a-z0-9]/gi, "_")}_${nodes.length + 1}`;
      const node: Node = {
        id,
        type: "wf",
        position: { x: 40 + (nodes.length % 3) * 220, y: 40 + Math.floor(nodes.length / 3) * 120 },
        data: {
          label: capability.split(".").pop(),
          capability,
          input: {},
        } as WorkflowNodeData,
      };
      setNodes((nds) => [...nds, node]);
    },
    [nodes.length, setNodes]
  );

  const buildPayload = useCallback(() => {
    const deps: Record<string, string[]> = {};
    for (const e of edges) {
      deps[e.target] = [...(deps[e.target] || []), e.source];
    }
    const wfNodes = nodes.map((n) => {
      const d = n.data as WorkflowNodeData;
      return {
        id: n.id,
        capability: d.capability,
        title: d.label,
        input: d.input || {},
        dependsOn: deps[n.id] || [],
      };
    });
    return { name, nodes: wfNodes };
  }, [edges, nodes, name]);

  const save = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/v1/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSavedId(data.workflow.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }, [buildPayload]);

  const run = useCallback(async () => {
    setError(null);
    setRunning(true);
    setLastRun(null);
    try {
      let id = savedId;
      if (!id) {
        const res = await fetch("/api/v1/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload()),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Save failed");
        id = data.workflow.id;
        setSavedId(id);
      }
      const runRes = await fetch(`/api/v1/workflows/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const runData = await runRes.json();
      if (!runRes.ok) throw new Error(runData.error || "Run failed");
      setLastRun(runData.run);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }, [buildPayload, savedId]);

  const stepSummary = useMemo(() => {
    if (!lastRun || typeof lastRun !== "object") return null;
    const r = lastRun as { status?: string; steps?: Array<{ capability: string; status: string; error?: string }>; finalOutput?: unknown };
    return r;
  }, [lastRun]);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#020617", color: "#e2e8f0" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e293b", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>AgentBazaar — Workflow Builder</h1>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 8, padding: "6px 10px", fontSize: 14, width: 220 }}
          placeholder="Workflow name"
        />
        <button onClick={save} style={btn}>💾 Save</button>
        <button onClick={run} disabled={running || nodes.length === 0} style={{ ...btn, background: "#10b981" }}>
          {running ? "Running…" : "▶ Run"}
        </button>
        {savedId && <span style={{ fontSize: 12, opacity: 0.6 }}>saved: {savedId}</span>}
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Palette */}
        <div style={{ width: 210, borderRight: "1px solid #1e293b", padding: 10, overflowY: "auto" }}>
          <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, marginBottom: 8 }}>CAPABILITIES (click to add)</div>
          {CAPABILITIES.map((cap) => (
            <button
              key={cap}
              onClick={() => addNode(cap)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "#0f172a",
                border: `1px solid ${colorFor(cap)}`,
                color: "#e2e8f0",
                borderRadius: 8,
                padding: "7px 10px",
                marginBottom: 6,
                fontSize: 12,
                fontFamily: "monospace",
                cursor: "pointer",
              }}
            >
              {cap}
            </button>
          ))}
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 12, lineHeight: 1.5 }}>
            Connect nodes to chain them. Outputs flow downstream via <code>$nodes.&lt;id&gt;</code>.
          </div>
        </div>

        {/* Canvas */}
        <div style={{ flex: 1 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            style={{ background: "#020617" }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#1e293b" gap={20} />
            <Controls />
            <MiniMap style={{ background: "#0f172a" }} nodeColor="#334155" />
          </ReactFlow>
        </div>

        {/* Results */}
        <div style={{ width: 280, borderLeft: "1px solid #1e293b", padding: 12, overflowY: "auto", fontSize: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>RUN RESULTS</div>
          {error && <div style={{ color: "#f87171", marginBottom: 8 }}>{error}</div>}
          {!stepSummary && <div style={{ opacity: 0.5 }}>Nothing yet — save & run.</div>}
          {stepSummary && (
            <div>
              <div style={{ marginBottom: 8 }}>
                Status: <b style={{ color: stepSummary.status === "completed" ? "#34d399" : "#f87171" }}>{stepSummary.status}</b>
              </div>
              {(stepSummary.steps || []).map((s, i) => (
                <div key={i} style={{ border: "1px solid #1e293b", borderRadius: 8, padding: 8, marginBottom: 6 }}>
                  <div style={{ fontFamily: "monospace" }}>{s.capability}</div>
                  <div style={{ opacity: 0.7 }}>
                    {s.status === "completed" ? "✅ done" : s.status === "failed" ? `❌ ${s.error || "failed"}` : "⏳ " + s.status}
                  </div>
                </div>
              ))}
              {stepSummary.finalOutput != null && (
                <pre style={{ background: "#0f172a", borderRadius: 8, padding: 8, overflowX: "auto", fontSize: 11 }}>
                  {JSON.stringify(stepSummary.finalOutput, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "#3b82f6",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
