import { NextRequest } from "next/server";
import { db, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/escrow — list escrows */
export async function GET() {
  ensureSeedCatalog();
  return json({ ok: true, escrows: db.listEscrows() });
}
