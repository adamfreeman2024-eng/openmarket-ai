/**
 * Catalog discovery params — pure helpers shared by /catalog (server component)
 * and unit tests. Mirrors the ranked search API surface
 * (GET /api/v1/offers/search) so the human-facing page and the machine API
 * behave identically.
 */

export const CATALOG_SORTS = [
  "relevance",
  "price_low",
  "price_high",
  "reputation",
  "speed",
  "rating",
] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number];

export type CatalogParams = {
  q?: string;
  capability?: string;
  category?: string;
  tags: string[];
  sortBy?: CatalogSort;
  minRating?: number;
  minReviewRating?: number;
  maxPrice?: number;
  asset?: "HBAR" | "USDC";
  limit: number;
};

export const DEFAULT_LIMIT = 50;

/** Normalize raw URLSearchParams into a safe CatalogParams (clamped/validated). */
export function parseCatalogParams(sp: URLSearchParams): CatalogParams {
  const rawQ = sp.get("q")?.trim();
  const q = rawQ ? rawQ : undefined;

  const capability = sp.get("capability")?.trim() || undefined;
  const category = sp.get("category")?.trim() || undefined;

  const tags = (sp.get("tags") || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const rawSort = sp.get("sortBy");
  const sortBy = CATALOG_SORTS.includes(rawSort as CatalogSort)
    ? (rawSort as CatalogSort)
    : undefined;

  const minRating = parseBounded(sp.get("minRating"), 0, 1);
  const minReviewRating = parseBounded(sp.get("minReviewRating"), 1, 5);
  const maxPrice = parseBounded(sp.get("maxPrice"), 0, Number.MAX_SAFE_INTEGER);

  const rawAsset = sp.get("asset");
  const asset =
    rawAsset === "HBAR" || rawAsset === "USDC" ? rawAsset : undefined;

  const rawLimit = Number(sp.get("limit") || DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(100, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;

  return {
    q,
    capability,
    category,
    tags,
    sortBy,
    minRating,
    minReviewRating,
    maxPrice,
    asset,
    limit,
  };
}

function parseBounded(
  raw: string | null,
  min: number,
  max: number
): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (n < min || n > max) return undefined;
  return n;
}

/** Build a /catalog href that preserves the current filter state. */
export function catalogHref(params: CatalogParams): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.capability) sp.set("capability", params.capability);
  if (params.category) sp.set("category", params.category);
  if (params.tags.length > 0) sp.set("tags", params.tags.join(","));
  if (params.sortBy) sp.set("sortBy", params.sortBy);
  if (params.minRating != null) sp.set("minRating", String(params.minRating));
  if (params.minReviewRating != null)
    sp.set("minReviewRating", String(params.minReviewRating));
  if (params.maxPrice != null) sp.set("maxPrice", String(params.maxPrice));
  if (params.asset) sp.set("asset", params.asset);
  if (params.limit !== DEFAULT_LIMIT) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  return qs ? `/catalog?${qs}` : "/catalog";
}

/** Category = capability prefix before the first dot (e.g. "text.translate" → "text"). */
export function deriveCategories(
  offers: { capability: string }[]
): string[] {
  const seen = new Set<string>();
  for (const o of offers) {
    const prefix = o.capability.split(".")[0];
    if (prefix) seen.add(prefix);
  }
  return [...seen].sort();
}

/** Most common offer tags, capped at `max`. */
export function derivePopularTags(
  offers: { tags: string[] }[],
  max = 8
): string[] {
  const counts = new Map<string, number>();
  for (const o of offers) {
    for (const t of o.tags) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}
