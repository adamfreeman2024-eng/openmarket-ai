import { marketCard } from "@/lib/config";
import Link from "next/link";
import {
  VerificationBadge,
  TrustTiersLegend,
} from "@/app/components/VerificationBadge";
import {
  parseCatalogParams,
  catalogHref,
  deriveCategories,
  derivePopularTags,
  CATALOG_SORTS,
  type CatalogParams,
} from "@/lib/catalog-params";

export const dynamic = "force-dynamic";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ensureSeedCatalog, db } = await import("@/lib/store");
  const { searchOffers } = await import("@/lib/ranking");
  const { getReviewStats } = await import("@/lib/reputation-v2");
  ensureSeedCatalog();

  // Normalize Next's searchParams object into URLSearchParams, then validate.
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") sp.set(k, v);
  }
  const p = parseCatalogParams(sp);

  const agentMap = new Map(db.listAgents().map((a) => [a.id, a]));
  const allOffers = db.listOffers();
  const reviewStats = new Map<string, { average: number; total: number }>();
  for (const a of db.listAgents()) {
    const s = getReviewStats(a.id);
    if (s.total > 0) reviewStats.set(a.id, { average: s.average, total: s.total });
  }

  const results = searchOffers(allOffers, agentMap, {
    q: p.q,
    capability: p.capability,
    category: p.category,
    tags: p.tags.length > 0 ? p.tags : undefined,
    sortBy: p.sortBy,
    minRating: p.minRating,
    minReviewRating: p.minReviewRating,
    maxPrice: p.maxPrice,
    asset: p.asset,
    limit: p.limit,
    reviewStats,
  }).map((r) => ({
    ...r,
    seller: r.seller
      ? { ...r.seller, reviews: reviewStats.get(r.offer.agentId) || null }
      : null,
  }));

  const card = marketCard();
  const capabilities = [...new Set(allOffers.map((o) => o.capability))].sort();
  const categories = deriveCategories(allOffers);
  const popularTags = derivePopularTags(allOffers, 8);

  const tierCounts = { bronze: 0, silver: 0, gold: 0 };
  for (const a of agentMap.values()) {
    const t = a.verificationStatus || "bronze";
    if (t === "silver") tierCounts.silver += 1;
    else if (t === "gold") tierCounts.gold += 1;
    else tierCounts.bronze += 1;
  }

  const sortLabels: Record<string, string> = {
    relevance: "Relevance",
    price_low: "Price ↑",
    price_high: "Price ↓",
    reputation: "Reputation",
    speed: "Speed",
    rating: "Rating",
  };

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

      {/* Search + sort + price/rating filters (GET form → server-rendered) */}
      <form method="get" action="/catalog" className="card">
        <h2>Search &amp; filter</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {p.capability ? (
            <input type="hidden" name="capability" value={p.capability} />
          ) : null}
          {p.category ? (
            <input type="hidden" name="category" value={p.category} />
          ) : null}
          {p.tags.length > 0 ? (
            <input type="hidden" name="tags" value={p.tags.join(",")} />
          ) : null}
          <input
            type="search"
            name="q"
            defaultValue={p.q || ""}
            placeholder="Search title / description / tag…"
            style={{
              flex: "1 1 220px",
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #334155",
              background: "#0b1220",
              color: "#e5e7eb",
              fontSize: 13,
            }}
          />
          <select
            name="sortBy"
            defaultValue={p.sortBy || "relevance"}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #334155",
              background: "#0b1220",
              color: "#e5e7eb",
              fontSize: 13,
            }}
          >
            {CATALOG_SORTS.map((s) => (
              <option key={s} value={s}>
                {sortLabels[s]}
              </option>
            ))}
          </select>
          <select
            name="minRating"
            defaultValue={p.minRating != null ? String(p.minRating) : ""}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #334155",
              background: "#0b1220",
              color: "#e5e7eb",
              fontSize: 13,
            }}
          >
            <option value="">Any success rate</option>
            <option value="0.9">90%+ success</option>
            <option value="0.8">80%+ success</option>
            <option value="0.7">70%+ success</option>
          </select>
          <input
            type="number"
            name="maxPrice"
            defaultValue={p.maxPrice != null ? String(p.maxPrice) : ""}
            placeholder="Max price"
            min="0"
            step="any"
            style={{
              width: 110,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #334155",
              background: "#0b1220",
              color: "#e5e7eb",
              fontSize: 13,
            }}
          />
          <select
            name="asset"
            defaultValue={p.asset || ""}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #334155",
              background: "#0b1220",
              color: "#e5e7eb",
              fontSize: 13,
            }}
          >
            <option value="">HBAR or USDC</option>
            <option value="HBAR">HBAR</option>
            <option value="USDC">USDC</option>
          </select>
          <button
            type="submit"
            className="link"
            style={{
              padding: "6px 14px",
              border: "1px solid #38bdf8",
              borderRadius: 999,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Apply
          </button>
          {p.q || p.sortBy || p.minRating != null || p.maxPrice != null || p.asset ? (
            <Link href={catalogHref({ ...p, q: undefined, sortBy: undefined, minRating: undefined, minReviewRating: undefined, maxPrice: undefined, asset: undefined })} className="link" style={{ fontSize: 12 }}>
              Reset filters
            </Link>
          ) : null}
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          {results.length} offer{results.length === 1 ? "" : "s"}
          {p.q ? <> for “{p.q}”</> : null}
          {p.category ? <> in <strong>{p.category}</strong></> : null}
          {p.tags.length > 0 ? <> tagged <strong>{p.tags.join(", ")}</strong></> : null}
        </p>
      </form>

      {/* Category facets */}
      {categories.length > 0 && (
        <div className="card">
          <h2>Categories</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Link
              href={catalogHref({ ...p, category: undefined })}
              className="link"
              style={{
                padding: "4px 10px",
                border: `1px solid ${p.category ? "#334155" : "#38bdf8"}`,
                borderRadius: 999,
                fontSize: 12,
              }}
            >
              All categories
            </Link>
            {categories.map((cat) => {
              const count = allOffers.filter((o) => o.capability.startsWith(cat)).length;
              return (
                <Link
                  key={cat}
                  href={catalogHref({ ...p, category: p.category === cat ? undefined : cat })}
                  className="link"
                  style={{
                    padding: "4px 10px",
                    border: `1px solid ${p.category === cat ? "#38bdf8" : "#334155"}`,
                    borderRadius: 999,
                    fontSize: 12,
                  }}
                >
                  {cat} ({count})
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Popular tags */}
      {popularTags.length > 0 && (
        <div className="card">
          <h2>Popular tags</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Link
              href={catalogHref({ ...p, tags: [] })}
              className="link"
              style={{
                padding: "4px 10px",
                border: `1px solid ${p.tags.length === 0 ? "#38bdf8" : "#334155"}`,
                borderRadius: 999,
                fontSize: 12,
              }}
            >
              All tags
            </Link>
            {popularTags.map((tag) => {
              const active = p.tags.includes(tag);
              const nextTags = active
                ? p.tags.filter((t) => t !== tag)
                : [...p.tags, tag];
              return (
                <Link
                  key={tag}
                  href={catalogHref({ ...p, tags: nextTags })}
                  className="link"
                  style={{
                    padding: "4px 10px",
                    border: `1px solid ${active ? "#38bdf8" : "#334155"}`,
                    borderRadius: 999,
                    fontSize: 12,
                  }}
                >
                  #{tag}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Capability pills (exact capability) */}
      <div className="card">
        <h2>Filter by capability</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Link
            href={catalogHref({ ...p, capability: undefined })}
            className="link"
            style={{
              padding: "4px 10px",
              border: `1px solid ${p.capability ? "#334155" : "#38bdf8"}`,
              borderRadius: 999,
              fontSize: 12,
            }}
          >
            All ({allOffers.length})
          </Link>
          {capabilities.map((cap) => (
            <Link
              key={cap}
              href={catalogHref({ ...p, capability: p.capability === cap ? undefined : cap })}
              className="link"
              style={{
                padding: "4px 10px",
                border: `1px solid ${p.capability === cap ? "#38bdf8" : "#334155"}`,
                borderRadius: 999,
                fontSize: 12,
              }}
            >
              {cap}
            </Link>
          ))}
        </div>
      </div>

      {/* Trust tiers summary */}
      <div className="card">
        <h2>Trust tiers</h2>
        <p className="muted small">
          Every seller shows a verification badge. Silver = GitHub ownership
          proven. Gold = automated code audit.
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

      {/* Results */}
      <div className="card">
        {results.length === 0 && (
          <p className="muted">No active offers match these filters.</p>
        )}
        {results.map((r) => {
          const sales = r.seller?.stats.sales ?? 0;
          const success = r.seller?.stats.success ?? 0;
          const fail = r.seller?.stats.fail ?? 0;
          const total = success + fail;
          const successRate = total === 0 ? 0.8 : success / total;
          const tier = r.seller?.verificationStatus || "bronze";
          const gh = r.seller?.githubHandle;
          const reviews = r.seller?.reviews;
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
                {r.offer.tags.length > 0
                  ? " · " + r.offer.tags.map((t) => `#${t}`).join(" ")
                  : null}
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
                  {reviews && reviews.total > 0 ? (
                    <span style={{ color: "#fbbf24" }}>
                      {" · "}
                      {"★".repeat(Math.round(reviews.average))}
                      {"☆".repeat(5 - Math.round(reviews.average))}{" "}
                      {reviews.average.toFixed(1)} ({reviews.total})
                    </span>
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
