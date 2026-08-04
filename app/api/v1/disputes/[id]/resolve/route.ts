import { NextRequest } from "next/server";
import { db, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import { resolveDispute, getDispute } from "@/lib/dispute";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const Body = z.object({
  resolution: z.enum(["refund", "keep", "partial"]),
  note: z.string().max(2000).optional(),
  as: z.enum(["seller", "platform"]).default("seller"),
});

/**
 * POST /api/v1/disputes/:id/resolve
 * Seller can resolve voluntarily (refund/keep/partial).
 * Platform (OPERATOR_API_KEY) can mediate and force a resolution.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const dispute = getDispute(id);
  if (!dispute) return json({ ok: false, error: "Dispute not found" }, 404);

  const rl = await redisRateLimit(`dispute-resolve:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "resolution required (refund|keep|partial)" }, 400);
  }

  if (parsed.data.as === "platform") {
    const operatorKey = process.env.OPERATOR_API_KEY;
    const key =
      req.headers.get("x-api-key") ||
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!operatorKey || key !== operatorKey) {
      return json({ ok: false, error: "Platform key required" }, 403);
    }
    const resolved = resolveDispute(
      id,
      parsed.data.resolution,
      "platform",
      parsed.data.note
    );
    if (!resolved) return json({ ok: false, error: "Cannot resolve" }, 409);
    return json({ ok: true, dispute: resolved });
  }

  // Seller resolution
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;
  if (dispute.sellerAgentId !== agent.id) {
    return json({ ok: false, error: "Only seller can resolve" }, 403);
  }
  const resolved = resolveDispute(
    id,
    parsed.data.resolution,
    "seller",
    parsed.data.note
  );
  if (!resolved) return json({ ok: false, error: "Cannot resolve" }, 409);

  return json({ ok: true, dispute: resolved });
}
