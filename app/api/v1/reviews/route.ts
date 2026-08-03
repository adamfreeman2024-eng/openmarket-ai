import { NextRequest } from "next/server";
import { db, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { addReview, getReviewStats } from "@/lib/reputation-v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/reviews?agentId=... — review stats for an agent */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const agentId = req.nextUrl.searchParams.get("agentId")?.trim();
  if (!agentId) {
    return json({ ok: false, error: "agentId query param required" }, 400);
  }
  const stats = getReviewStats(agentId);
  return json({ ok: true, agentId, stats });
}

/**
 * POST /api/v1/reviews — buyer reviews a seller after a completed order.
 * Body: { agentId, orderId, rating (1-5), comment? }
 * Anti-gaming: self-reviews flagged, review-bombing flagged, suspicious patterns flagged.
 */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const body = await req.json().catch(() => ({}));
  const agentId = String(body.agentId || "").trim();
  const orderId = String(body.orderId || "").trim();
  const rating = Number(body.rating);
  const comment = String(body.comment || "").slice(0, 500);

  if (!agentId || !orderId) {
    return json({ ok: false, error: "agentId and orderId required" }, 400);
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return json({ ok: false, error: "rating must be an integer 1-5" }, 400);
  }

  const seller = db.getAgent(agentId);
  if (!seller) return json({ ok: false, error: "Seller agent not found" }, 404);

  // Verify the buyer actually completed a real order with this seller.
  const order = db
    .listOrders()
    .find(
      (o) =>
        o.id === orderId &&
        o.sellerAgentId === agentId &&
        o.buyerAgentId === agent.id &&
        o.status === "completed"
    );
  if (!order) {
    return json(
      { ok: false, error: "No completed order found for this buyer/seller pair" },
      403
    );
  }

  const review = addReview({
    agentId,
    orderId,
    reviewerAgentId: agent.id,
    rating,
    comment,
  });

  return json({
    ok: true,
    review: {
      id: review.id,
      agentId: review.agentId,
      rating: review.rating,
      comment: review.comment,
      verified: review.verified,
      flagged: review.flagged,
      flagReason: review.flagReason,
    },
    warning: review.warning,
    stats: getReviewStats(agentId),
  });
}
