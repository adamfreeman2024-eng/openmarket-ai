import { NextRequest } from "next/server";
import { json, options } from "@/lib/http";
import {
  fetchMirrorTransaction,
  normalizeTxId,
  verifyPayment,
  STRICT_SETTLEMENT,
  usdcMeta,
} from "@/lib/settlement";
import { NETWORK, MIRROR } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * GET /api/v1/settlement/check?transactionId=...
 * POST { transactionId, expectedPayTo, expectedAmount, asset }
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const transactionId = sp.get("transactionId") || "";
  if (!transactionId) {
    return json({
      ok: true,
      network: NETWORK,
      mirror: MIRROR,
      strictSettlement: STRICT_SETTLEMENT,
      usdc: usdcMeta(),
      usage: {
        get: "/api/v1/settlement/check?transactionId=0.0.x@s.n",
        post: {
          transactionId: "string",
          expectedPayTo: "0.0.x",
          expectedAmount: 0.1,
          asset: "HBAR|USDC",
        },
      },
    });
  }
  const fetched = await fetchMirrorTransaction(transactionId);
  return json({
    ok: fetched.ok,
    normalizedId: normalizeTxId(transactionId),
    mirror: MIRROR,
    error: fetched.error,
    tx: fetched.tx ?? null,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const transactionId = String(body.transactionId || "");
  const expectedPayTo = String(body.expectedPayTo || "");
  const expectedAmount = Number(body.expectedAmount || 0);
  const asset = String(body.asset || "HBAR");
  if (!transactionId || !expectedPayTo || !expectedAmount) {
    return json(
      {
        ok: false,
        error: "transactionId, expectedPayTo, expectedAmount required",
      },
      400
    );
  }
  const v = await verifyPayment({
    transactionId,
    expectedPayTo,
    expectedAmount,
    asset,
  });
  return json({
    result: v,
    strictSettlement: STRICT_SETTLEMENT,
    usdc: usdcMeta(),
  });
}
