import { marketCard } from "@/lib/config";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const { ensureSeedCatalog, db } = await import("@/lib/store");
  const { searchOffers } = await import("@/lib/ranking");
  ensureSeedCatalog();
  const agentMap = new Map(db.listAgents().map((a) => [a.id, a]));
  const results = searchOffers(db.listOffers(), agentMap, { limit: 50 });
  const card = marketCard();

  return (
    <main className="wrap">
      <p>
        <Link href="/" className="link">
          ← OpenMarket.ai
        </Link>
      </p>
      <span className="badge">Live catalog · ranked for agents</span>
      <h1>Offers</h1>
      <p className="muted">
        Machine API: <code>GET /api/v1/offers/search</code> · fee{" "}
        {card.fees.platformBps} bps
      </p>

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
              <div className="muted small">
                agent {r.seller?.name || r.offer.agentId} · successRate{" "}
                {(successRate * 100).toFixed(0)}% · sales {sales}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>Agent one-shot buy</h2>
        <pre>{`POST /api/v1/buy
X-Api-Key: omk_...
{ "offerId": "off_...", "transactionId": "0.0.x@s.n" }
# or dev: { "offerId": "...", "devFakePay": true }`}</pre>
      </div>
    </main>
  );
}
