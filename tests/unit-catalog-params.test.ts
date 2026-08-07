import { describe, it, expect } from "vitest";
import {
  parseCatalogParams,
  catalogHref,
  deriveCategories,
  derivePopularTags,
  DEFAULT_LIMIT,
} from "../lib/catalog-params";

describe("parseCatalogParams", () => {
  it("parses empty params to defaults", () => {
    const p = parseCatalogParams(new URLSearchParams(""));
    expect(p.q).toBeUndefined();
    expect(p.capability).toBeUndefined();
    expect(p.category).toBeUndefined();
    expect(p.tags).toEqual([]);
    expect(p.sortBy).toBeUndefined();
    expect(p.minRating).toBeUndefined();
    expect(p.minReviewRating).toBeUndefined();
    expect(p.minOnTimeRate).toBeUndefined();
    expect(p.escrowOnly).toBe(false);
    expect(p.maxPrice).toBeUndefined();
    expect(p.asset).toBeUndefined();
    expect(p.limit).toBe(DEFAULT_LIMIT);
  });

  it("trims q and drops empty strings", () => {
    expect(parseCatalogParams(new URLSearchParams("q=  ")).q).toBeUndefined();
    expect(parseCatalogParams(new URLSearchParams("q=  hello ")).q).toBe("hello");
  });

  it("splits and trims comma-separated tags", () => {
    const p = parseCatalogParams(
      new URLSearchParams("tags= a ,b,,c ")
    );
    expect(p.tags).toEqual(["a", "b", "c"]);
  });

  it("validates sortBy against the whitelist", () => {
    expect(parseCatalogParams(new URLSearchParams("sortBy=rating")).sortBy).toBe("rating");
    expect(parseCatalogParams(new URLSearchParams("sortBy=price_low")).sortBy).toBe("price_low");
    expect(parseCatalogParams(new URLSearchParams("sortBy=quality")).sortBy).toBe("quality");
    expect(parseCatalogParams(new URLSearchParams("sortBy=bogus")).sortBy).toBeUndefined();
  });

  it("parses minOnTimeRate and escrowOnly", () => {
    const p = parseCatalogParams(new URLSearchParams("minOnTimeRate=0.9&escrowOnly=1"));
    expect(p.minOnTimeRate).toBe(0.9);
    expect(p.escrowOnly).toBe(true);
    expect(parseCatalogParams(new URLSearchParams("minOnTimeRate=1.5")).minOnTimeRate).toBeUndefined();
    expect(parseCatalogParams(new URLSearchParams("escrowOnly=false")).escrowOnly).toBe(false);
    expect(parseCatalogParams(new URLSearchParams("escrowOnly=true")).escrowOnly).toBe(true);
  });

  it("bounds numeric filters", () => {
    expect(parseCatalogParams(new URLSearchParams("minRating=1.2")).minRating).toBeUndefined();
    expect(parseCatalogParams(new URLSearchParams("minRating=0.9")).minRating).toBe(0.9);
    expect(parseCatalogParams(new URLSearchParams("minRating=abc")).minRating).toBeUndefined();
    expect(parseCatalogParams(new URLSearchParams("minReviewRating=4")).minReviewRating).toBe(4);
    expect(parseCatalogParams(new URLSearchParams("minReviewRating=9")).minReviewRating).toBeUndefined();
    expect(parseCatalogParams(new URLSearchParams("maxPrice=100")).maxPrice).toBe(100);
    expect(parseCatalogParams(new URLSearchParams("maxPrice=-5")).maxPrice).toBeUndefined();
  });

  it("validates asset and clamps limit", () => {
    expect(parseCatalogParams(new URLSearchParams("asset=USDC")).asset).toBe("USDC");
    expect(parseCatalogParams(new URLSearchParams("asset=ETH")).asset).toBeUndefined();
    expect(parseCatalogParams(new URLSearchParams("limit=500")).limit).toBe(100);
    expect(parseCatalogParams(new URLSearchParams("limit=0")).limit).toBe(1);
    expect(parseCatalogParams(new URLSearchParams("limit=nope")).limit).toBe(DEFAULT_LIMIT);
  });
});

describe("catalogHref", () => {
  it("returns /catalog when nothing is set", () => {
    expect(
      catalogHref({
        tags: [],
        limit: DEFAULT_LIMIT,
      })
    ).toBe("/catalog");
  });

  it("round-trips state and omits defaults", () => {
    const p = parseCatalogParams(
      new URLSearchParams("q=translate&category=text&tags=a,b&sortBy=rating&minRating=0.8&maxPrice=5&asset=HBAR&limit=50")
    );
    const href = catalogHref(p);
    expect(href).toContain("q=translate");
    expect(href).toContain("category=text");
    expect(href).toContain("tags=a%2Cb");
    expect(href).toContain("sortBy=rating");
    expect(href).toContain("minRating=0.8");
    expect(href).toContain("maxPrice=5");
    expect(href).toContain("asset=HBAR");
    expect(href).not.toContain("limit=");
  });

  it("round-trips SLA + escrow-only filters", () => {
    const p = parseCatalogParams(new URLSearchParams("minOnTimeRate=0.9&escrowOnly=1"));
    const href = catalogHref(p);
    expect(href).toContain("minOnTimeRate=0.9");
    expect(href).toContain("escrowOnly=1");
    const back = parseCatalogParams(new URLSearchParams(href.replace("/catalog?", "")));
    expect(back.minOnTimeRate).toBe(0.9);
    expect(back.escrowOnly).toBe(true);
  });

  it("preserves capability and category when building", () => {
    const href = catalogHref({
      capability: "text.translate",
      category: "text",
      tags: [],
      limit: DEFAULT_LIMIT,
    });
    expect(href).toBe("/catalog?capability=text.translate&category=text");
  });
});

describe("deriveCategories", () => {
  it("extracts capability prefixes, dedupes and sorts", () => {
    const cats = deriveCategories([
      { capability: "text.translate" },
      { capability: "text.summarize" },
      { capability: "code.review" },
      { capability: "code.review" },
    ]);
    expect(cats).toEqual(["code", "text"]);
  });

  it("returns empty for no offers", () => {
    expect(deriveCategories([])).toEqual([]);
  });
});

describe("derivePopularTags", () => {
  it("ranks tags by frequency and caps the result", () => {
    const tags = derivePopularTags(
      [
        { tags: ["fast", "ai", "trusted"] },
        { tags: ["fast", "ai"] },
        { tags: ["fast"] },
      ],
      2
    );
    expect(tags).toEqual(["fast", "ai"]);
  });

  it("returns empty for no tags", () => {
    expect(derivePopularTags([{ tags: [] }])).toEqual([]);
  });
});
