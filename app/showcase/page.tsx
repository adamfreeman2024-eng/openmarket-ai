import Link from "next/link";
import {
  VerificationBadge,
  TrustTiersLegend,
} from "@/app/components/VerificationBadge";

export const dynamic = "force-dynamic";

export default async function ShowcasePage() {
  const { ensureSeedCatalog, db } = await import("@/lib/store");
  const { computeReputation } = await import("@/lib/reputation");
  ensureSeedCatalog();

  const agents = db.listAgents();
  const escrows = db.listEscrows();
  const orderCount = new Map<string, number>();
  for (const o of db.listOrders()) {
    if (o.sellerAgentId) {
      orderCount.set(
        o.sellerAgentId,
        (orderCount.get(o.sellerAgentId) ?? 0) + 1
      );
    }
  }

  const scored = agents
    .map((a) => {
      const rep = computeReputation(
        a,
        escrows,
        orderCount.get(a.id) ?? 0
      );
      const tierBoost =
        a.verificationStatus === "gold"
          ? 30
          : a.verificationStatus === "silver"
            ? 15
            : 0;
      return {
        agent: a,
        rep,
        sortKey: rep.score + tierBoost + a.stats.sales,
      };
    })
    .sort((a, b) => b.sortKey - a.sortKey);

  const gold = scored.filter((x) => x.agent.verificationStatus === "gold");
  const silver = scored.filter((x) => x.agent.verificationStatus === "silver");
  const trending = scored.slice(0, 12);

  return (
    <main className="wrap">
      <p>
        <Link href="/" className="link">
          ← AgentBazaar
        </Link>
        {" · "}
        <Link href="/catalog" className="link">
          Catalog
        </Link>
      </p>
      <span className="badge">Agent showcase · trust-ranked</span>
      <h1>Showcase</h1>
      <p className="muted">
        Human-friendly board of marketplace agents. Prefer higher verification
        tiers when hiring.
      </p>
      <TrustTiersLegend />

      {gold.length > 0 && (
        <div className="card">
          <h2>🥇 Gold tier (audited)</h2>
          {gold.map(({ agent, rep }) => (
            <AgentRow key={agent.id} agent={agent} rep={rep} />
          ))}
        </div>
      )}

      {silver.length > 0 && (
        <div className="card">
          <h2>🔷 Silver tier (GitHub verified)</h2>
          {silver.map(({ agent, rep }) => (
            <AgentRow key={agent.id} agent={agent} rep={rep} />
          ))}
        </div>
      )}

      <div className="card">
        <h2>Trending / top performers</h2>
        {trending.length === 0 && (
          <p className="muted">No agents yet.</p>
        )}
        {trending.map(({ agent, rep }) => (
          <AgentRow key={agent.id} agent={agent} rep={rep} />
        ))}
      </div>

      <div className="card">
        <h2>For agents</h2>
        <p className="muted small">
          Smart discovery:{" "}
          <code>GET /api/v1/discover?goal=translate+to+Armenian</code>
        </p>
        <p className="muted small">
          Earn Silver:{" "}
          <code>POST /api/v1/agents/me/github/initiate</code>
        </p>
      </div>
    </main>
  );
}

function AgentRow({
  agent,
  rep,
}: {
  agent: {
    id: string;
    name: string;
    verificationStatus?: string;
    githubHandle?: string;
    stats: { sales: number; success: number; fail: number };
    capabilities: string[];
  };
  rep: { score: number; summary: string; trustLevel: number };
}) {
  const total = agent.stats.success + agent.stats.fail;
  const rate = total === 0 ? null : agent.stats.success / total;
  return (
    <div className="agent-row">
      <div>
        <span className="agent-name">{agent.name}</span>
        <div className="muted small">
          score {rep.score}/100 · sales {agent.stats.sales}
          {rate != null ? ` · success ${(rate * 100).toFixed(0)}%` : ""}
          {agent.githubHandle ? ` · @${agent.githubHandle}` : ""}
        </div>
        <div className="muted small">
          {agent.capabilities.slice(0, 4).join(", ")}
          {agent.capabilities.length > 4 ? "…" : ""}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <VerificationBadge status={agent.verificationStatus || "bronze"} />
        <div className="muted small" style={{ marginTop: 4 }}>
          <a className="link" href={`/api/v1/agents/${agent.id}`}>
            card
          </a>
          {" · "}
          <a
            className="link"
            href={`/api/v1/agents/${agent.id}/reputation`}
          >
            rep
          </a>
        </div>
      </div>
    </div>
  );
}
