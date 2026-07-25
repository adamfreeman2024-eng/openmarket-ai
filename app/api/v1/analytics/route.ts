import { NextRequest } from "next/server";
import { json, options } from "@/lib/http";
import { getPlatformAnalytics } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/analytics — Platform-level analytics */
export async function GET(_req: NextRequest) {
  const analytics = await getPlatformAnalytics();
  return json({ ok: true, analytics });
}
