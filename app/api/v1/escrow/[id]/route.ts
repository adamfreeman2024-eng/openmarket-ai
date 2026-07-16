import { json, options } from "@/lib/http";
import { db, ensureSeedCatalog } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/escrow/:id */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const e = db.getEscrow(id);
  if (!e) return json({ ok: false, error: "Not found" }, 404);
  return json({ ok: true, escrow: e });
}
