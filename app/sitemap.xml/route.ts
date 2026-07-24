import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const base = SITE_URL.replace(/\/$/, "");
  const urls = [
    "",
    "/catalog",
    "/how-it-works",
    "/terms",
    "/privacy",
    "/dashboard",
    "/llms.txt",
    "/agents.txt",
    "/openapi.json",
    "/.well-known/openmarket.json",
    "/.well-known/agent-card.json",
    "/api/v1/health",
    "/api/v1/ready",
    "/api/v1/offers/search",
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url><loc>${base}${u}</loc><changefreq>hourly</changefreq></url>`
  )
  .join("\n")}
</urlset>`;
  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
