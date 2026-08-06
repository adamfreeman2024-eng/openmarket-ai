import { NextRequest } from "next/server";
import { json, options } from "@/lib/http";
import { db, ensureSeedCatalog } from "@/lib/store";
import { computeLeaderboard } from "@/lib/developer-portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * GET /api/v1/developers — Developer Portal leaderboard.
 * Returns top developers by gross revenue and by completed hires.
 * Public, no auth required (data is derived from public agents/orders).
 */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const url = new URL(req.url);
  const parsed = parseInt(url.searchParams.get("limit") ?? "10", 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 10;

  const board = computeLeaderboard(db.listAgents(), db.listOrders(), limit);

  return json({
    ok: true,
    limit,
    count: {
      byRevenue: board.byRevenue.length,
      byHires: board.byHires.length,
    },
    ...board,
  });
}
