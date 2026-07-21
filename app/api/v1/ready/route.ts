import { json, options } from "@/lib/http";
import { productionChecks } from "@/lib/production-check";
import { db, ensureSeedCatalog } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * GET /api/v1/ready — Kubernetes-style readiness
 * 200 when store works and critical production checks pass (in production).
 * 503 when not ready.
 */
export async function GET() {
  ensureSeedCatalog();
  const prod = productionChecks();

  let storeOk = true;
  let storeError: string | undefined;
  try {
    db.listAgents();
    db.backend();
  } catch (e) {
    storeOk = false;
    storeError = e instanceof Error ? e.message : "store error";
  }

  const ready = storeOk && prod.ready;
  const body = {
    ok: ready,
    status: ready ? "ready" : "not_ready",
    time: new Date().toISOString(),
    storeOk,
    storeError,
    storeBackend: storeOk ? db.backend() : null,
    productionMode: prod.productionMode,
    checks: prod.checks,
  };

  return json(body, ready ? 200 : 503);
}
