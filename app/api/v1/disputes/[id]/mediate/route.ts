import { NextRequest } from "next/server";
import { ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import { getDispute, applyMediation } from "@/lib/dispute";
import { llmFulfill } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * POST /api/v1/disputes/:id/mediate — AI-assisted platform mediation.
 *
 * Either party (buyer or seller) may invoke it. The AI mediator reviews the
 * dispute (reason, details, seller response) and proposes refund|keep|partial;
 * the platform then applies the decision to the dispute and its escrow.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const dispute = getDispute(id);
  if (!dispute) return json({ ok: false, error: "Dispute not found" }, 404);

  const rl = await redisRateLimit(`dispute-mediate:${clientKey(req)}`, 10, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const isParty =
    dispute.buyerAgentId === agent.id || dispute.sellerAgentId === agent.id;
  if (!isParty) {
    return json(
      { ok: false, error: "Only dispute parties can request mediation" },
      403
    );
  }

  const med = await llmFulfill("dispute.mediate", {
    reason: dispute.reason,
    description: dispute.description,
    seller_response: dispute.sellerResponse || "",
    buyer: dispute.buyerAgentId,
    seller: dispute.sellerAgentId,
  });
  if (!med.ok) {
    return json({ ok: false, error: `Mediation failed: ${med.error}` }, 502);
  }

  const result = med.result as {
    resolution: "refund" | "keep" | "partial";
    note?: string;
    model?: string;
  };
  if (!["refund", "keep", "partial"].includes(result.resolution)) {
    return json({ ok: false, error: "Invalid mediation result" }, 422);
  }

  const resolved = applyMediation(id, result.resolution, result.note);
  if (!resolved) {
    return json({ ok: false, error: "Cannot mediate a resolved dispute" }, 409);
  }

  return json({
    ok: true,
    dispute: resolved,
    mediation: {
      resolution: result.resolution,
      note: result.note,
      model: result.model,
    },
  });
}
