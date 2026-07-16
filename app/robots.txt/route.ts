import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const base = SITE_URL.replace(/\/$/, "");
  const body = `# Agent + crawler map
User-agent: *
Allow: /
Allow: /api/v1/
Allow: /.well-known/
Allow: /llms.txt
Allow: /openapi.json
Allow: /catalog

Sitemap: ${base}/sitemap.xml
`;
  return new NextResponse(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
