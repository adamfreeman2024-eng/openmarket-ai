import { NextRequest } from "next/server";
import { OrderPaySchema } from "@/lib/types";
import { db, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options } from "@/lib/http";
import { verifyPayment, fulfillInline } from "@/lib/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/orders/:id */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const order = db.getOrder(id);
  if (!order) return json({ ok: false, error: "Not found" }, 404);
  return json({ ok: true, order });
}
