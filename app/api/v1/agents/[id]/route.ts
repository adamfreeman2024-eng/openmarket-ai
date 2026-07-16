import { json, options } from "@/lib/http";
import { db, ensureSeedCatalog } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/agents/:id — Agent Card */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const a = db.getAgent(id);
  if (!a) return json({ ok: false, error: "Not found" }, 404);
  return json({
    ok: true,
    card: {
      id: a.id,
      name: a.name,
      walletAccountId: a.walletAccountId,
      capabilities: a.capabilities,
      homepage: a.homepage,
      webhookConfigured: Boolean(a.webhookUrl),
      policy: {
        dailySpendLimit: a.policy.dailySpendLimit,
        maxPerTx: a.policy.maxPerTx,
      },
      stats: a.stats,
      createdAt: a.createdAt,
    },
  });
}
