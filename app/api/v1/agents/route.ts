import { json, options } from "@/lib/http";
import { db, ensureSeedCatalog } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/agents — public list (no secrets) */
export async function GET() {
  ensureSeedCatalog();
  const agents = db.listAgents().map((a) => ({
    id: a.id,
    name: a.name,
    walletAccountId: a.walletAccountId,
    capabilities: a.capabilities,
    homepage: a.homepage,
    stats: {
      sales: a.stats.sales,
      successRate:
        a.stats.success + a.stats.fail === 0
          ? null
          : a.stats.success / (a.stats.success + a.stats.fail),
    },
    createdAt: a.createdAt,
  }));
  return json({ ok: true, agents });
}
