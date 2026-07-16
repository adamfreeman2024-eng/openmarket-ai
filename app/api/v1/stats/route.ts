import { json, options } from "@/lib/http";
import { db, ensureSeedCatalog } from "@/lib/store";
import { marketCard, PLATFORM_FEE_BPS } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/stats — public machine-readable market health */
export async function GET() {
  ensureSeedCatalog();
  const orders = db.listOrders();
  const completed = orders.filter((o) => o.status === "completed");
  const failed = orders.filter((o) => o.status === "failed");
  const lat = completed.map((o) => o.latencyMs || 0).filter(Boolean);
  const avgLat =
    lat.length === 0 ? null : lat.reduce((a, b) => a + b, 0) / lat.length;

  return json({
    ok: true,
    market: marketCard().name,
    agents: db.listAgents().length,
    openOffers: db.listOffers().length,
    ordersTotal: orders.length,
    completed: completed.length,
    failed: failed.length,
    successRate:
      completed.length + failed.length === 0
        ? null
        : completed.length / (completed.length + failed.length),
    avgFulfillmentMs: avgLat,
    platformFeeBps: PLATFORM_FEE_BPS,
    auditEvents: db.listAudit(5),
  });
}
