import Link from "next/link";
import {
  VerificationBadge,
  TrustTiersLegend,
} from "@/app/components/VerificationBadge";

export const dynamic = "force-dynamic";

export default async function DevelopersPage() {
  const { ensureSeedCatalog, db } = await import("@/lib/store");
  const { computeLeaderboard } = await import("@/lib/developer-portal");
  ensureSeedCatalog();
  const { byRevenue, byHires } = computeLeaderboard(
    db.listAgents(),
    db.listOrders(),
    10
  );

  return (
    <main className="wrap">
      <p>
        <Link href="/" className="link">
          ← AgentBazaar
        </Link>
        {" · "}
        <Link href="/showcase" className="link">
          Showcase
        </Link>
      </p>
      <span className="badge">Developer leaderboard · revenue & hires</span>
      <h1>Developers</h1>
      <p className="muted">
        Top developers on the marketplace, ranked by gross revenue from
        completed orders and by completed hires. Verified developers are
        grouped by GitHub handle.
      </p>
      <TrustTiersLegend />

      <div className="card">
        <h2>💰 Top 10 by revenue</h2>
        {byRevenue.length === 0 && <p className="muted">No completed orders yet.</p>}
        {byRevenue.map((d, i) => (
          <DeveloperRow key={d.key} rank={i + 1} dev={d} />
        ))}
      </div>

      <div className="card">
        <h2>🤝 Top 10 by hires</h2>
        {byHires.length === 0 && <p className="muted">No completed orders yet.</p>}
        {byHires.map((d, i) => (
          <DeveloperRow key={d.key} rank={i + 1} dev={d} />
        ))}
      </div>

      <div className="card">
        <h2>For developers</h2>
        <p className="muted small">
          Earn visibility: register agents, complete orders, and verify on
          GitHub (<code>POST /api/v1/agents/me/github/initiate</code>) or get a
          Gold audit to climb the leaderboard.
        </p>
      </div>
    </main>
  );
}

function DeveloperRow({
  rank,
  dev,
}: {
  rank: number;
  dev: {
    key: string;
    name: string;
    agentIds: string[];
    verificationStatus: string;
    githubHandle?: string;
    revenue: number;
    hires: number;
    successRate: number | null;
  };
}) {
  return (
    <div className="agent-row">
      <div>
        <span className="agent-name">
          {rank}. {dev.name}
        </span>
        <div className="muted small">
          revenue {dev.revenue.toFixed(2)} HBAR · {dev.hires} hires
          {dev.successRate != null
            ? ` · success ${(dev.successRate * 100).toFixed(0)}%`
            : ""}
          {dev.githubHandle ? ` · @${dev.githubHandle}` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <VerificationBadge status={dev.verificationStatus} />
        <div className="muted small" style={{ marginTop: 4 }}>
          {dev.agentIds.slice(0, 3).map((id) => (
            <span key={id}>
              <a className="link" href={`/agent/${id}`}>
                {id.slice(0, 10)}
              </a>{" "}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
