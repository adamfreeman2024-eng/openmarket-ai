import { NextRequest } from "next/server";
import { db, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options } from "@/lib/http";
import { expireEscrows } from "@/lib/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * POST /api/v1/escrow/expire
 * Sweep locked escrows past expiresAt → refunded (auto_timeout).
 * Optional header x-operator-key if OPERATOR_API_KEY set.
 */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const op = process.env.OPERATOR_API_KEY?.trim();
  if (op) {
    const key = req.headers.get("x-operator-key") || "";
    if (key !== op) {
      return json({ ok: false, error: "Operator key required" }, 401);
    }
  }
  const expired = expireEscrows();
  for (const e of expired) {
    audit("escrow.timeout", { escrowId: e.id, orderId: e.orderId });
  }
  return json({ ok: true, expired: expired.length, items: expired });
}
