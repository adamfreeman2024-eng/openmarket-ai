import { NextRequest } from "next/server";
import { db, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/offers/:id */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const o = db.getOffer(id);
  if (!o) return json({ ok: false, error: "Not found" }, 404);
  return json({ ok: true, offer: o });
}

/** DELETE /api/v1/offers/:id — seller deactivates own offer */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;
  const { id } = await ctx.params;
  const o = db.getOffer(id);
  if (!o) return json({ ok: false, error: "Not found" }, 404);
  if (o.agentId !== agent.id) {
    return json({ ok: false, error: "Not your offer" }, 403);
  }
  o.active = false;
  db.putOffer(o);
  audit("offer.deactivate", { offerId: id, agentId: agent.id });
  return json({ ok: true, offer: o });
}
