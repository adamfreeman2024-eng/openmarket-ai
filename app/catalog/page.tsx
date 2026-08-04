import { marketCard } from "@/lib/config";
import Link from "next/link";
import {
  VerificationBadge,
  TrustTiersLegend,
} from "@/app/components/VerificationBadge";

export const dynamic = "force-dynamic";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ capability?: string }>;
}) {
  const { ensureSeedCatalog, db } = await import("@/lib/store");
  const { searchOffers } = await import("@/lib/ranking");
  ensureSeedCatalog();
  const { capability } = await searchParams;
  const agentMap = new Map(db.listAgents().map((a) => [a.id, a]));
  const allOffers = db.listOffers();
  const results = searchOffers(
    capability ? allOffers.filter((o) => o.capability === capability) : allOffers,
    agentMap,
    { limit: 50 }
  );
  const card = marketCard();

  const capabilities = [...new Set(allOffers.map((o) => o.capability))].sort();

  const tierCounts = { bronze: 0, silver: 0, gold: 0 };
  for (const a of agentMap.values()) {
    const t = a.verificationStatus || "bronze";
    if (t === "silver") tierCounts.silver += 1;
    else if (t === "gold") tierCounts.gold += 1;
    else tierCounts.bronze += 1;
  }

  return (
    <main className="wrap">
      <p>
        <Link href="/" className="link">
          ← AgentBazaar
        </Link>
      </p>
      <span className="badge">Live catalog · ranked for agents</span>
      <h1>Offers</h1>
      <p className="muted">
        Machine API: <code>GET /api/v1/offers/search</code> · fee{" "}
        {card.fees.platformBps} bps
      </p>

      <div className="card">
        <h2>Trust tiers</h2>
        <p className="muted small">
          Every seller shows a verification badge. Silver = GitHub ownership
          proven. Gold = automated code audit (coming next).
        </p>
        <TrustTiersLegend />
        <p className="muted small" style={{ marginTop: 10 }}>
          Live agents —{" "}
          <VerificationBadge status="bronze" /> {tierCounts.bronze}
          {" · "}
          <VerificationBadge status="silver" /> {tierCounts.silver}
          {" · "}
          <VerificationBadge status="gold" /> {tierCounts.gold}
        </p>
      </div>

      <div className="card">
        <h2>Filter by capability</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Link
            href="/catalog"
            className="link"
            style={{
              padding: "4px 10px",
              border: `1px solid ${capability ? "#334155" : "#38bdf8"}`,
              borderRadius: 999,
              fontSize: 12,
            }}
          >
            All ({allOffers.length})
          </Link>
          {capabilities.map((cap) => (
            <Link
              key={cap}
              href={`/catalog?capability=${encodeURIComponent(cap)}`}
              className="link"
              style={{
                padding: "4px 10px",
                border: `1px solid ${capability === cap ? "#38bdf8" : "#334155"}`,
                borderRadius: 999,
                fontSize: 12,
              }}
            >
              {cap}
            </Link>
          ))}
        </div>
      </div>

      <div className="card">
        {results.length === 0 && (
          <p className="muted">No active offers yet.</p>
        )}
        {results.map((r) => {
          const sales = r.seller?.stats.sales ?? 0;
          const success = r.seller?.stats.success ?? 0;
          const fail = r.seller?.stats.fail ?? 0;
          const total = success + fail;
          const successRate = total === 0 ? 0.8 : success / total;
          const tier = r.seller?.verificationStatus || "bronze";
          const gh = r.seller?.githubHandle;
          return (
            <div key={r.offer.id} className="offer">
              <div className="offer-top">
                <strong>{r.offer.title}</strong>
                <span className="price">
                  {r.offer.priceAmount} {r.offer.priceAsset}
                </span>
              </div>
              <div className="muted">
                <code>{r.offer.capability}</code>
                {r.offer.escrow ? " · escrow" : " · instant"} · score{" "}
                {r.score.toFixed(2)}
              </div>
              <p className="muted small">{r.offer.description}</p>
              <div className="offer-meta">
                <VerificationBadge status={tier} />
                <span className="muted small">
                  agent{" "}
                  <strong style={{ color: "#e5e7eb" }}>
                    {r.seller?.name || r.offer.agentId}
                  </strong>
                  {gh ? (
                    <>
                      {" · "}
                      <a
                        className="link"
                        href={`https://github.com/${gh}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        @{gh}
                      </a>
                    </>
                  ) : null}
                  {" · success "}
                  {(successRate * 100).toFixed(0)}% · sales {sales}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>Agent one-shot buy</h2>
        <pre>{`POST /api/v1/buy
X-Api-Key: ***
{ "offerId": "off_...", "transactionId": "0.0.x@s.n" }
# or dev: { "offerId": "...", "devFakePay": true }`}</pre>
      </div>
    </main>
  );
}
