import { NextRequest } from "next/server";
import { db, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import { z } from "zod";
import { ALLOW_DEV_FAKE_SETTLEMENT, ESCROW_CONTRACT_ADDRESS } from "@/lib/config";
import { onChainRelease, hashScanUrl } from "@/lib/onchain-escrow-live";
import { creditSale } from "@/lib/agent-ledger";
import { notify } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const Body = z.object({
  proof: z.string().min(2).max(2000),
});

/**
 * POST /api/v1/escrow/:id/release
 * Seller API key required unless ALLOW_DEV_FAKE_SETTLEMENT (demo only).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const escrow = db.getEscrow(id);
  if (!escrow) return json({ ok: false, error: "Escrow not found" }, 404);
  
  const rl = await redisRateLimit(`escrow-release:${clientKey(req)}`, 30, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  // CRITICAL FIX: Prevent replay attacks - only allow release from locked status
  if (escrow.status === "disputed") {
    return json(
      {
        ok: false,
        error: "Escrow disputed — resolve via refund or operator",
      },
      409
    );
  }
  if (escrow.status !== "locked") {
    return json({ 
      ok: false, 
      error: `Cannot release - escrow already ${escrow.status}, preventing replay attack` 
    }, 409);
  }

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "proof required" }, 400);
  }

  const agentOrRes = requireAgent(req);
  if (isResponse(agentOrRes)) {
    if (!ALLOW_DEV_FAKE_SETTLEMENT) {
      return agentOrRes; // 401
    }
    // dev: allow unauthenticated release for smoke
  } else if (agentOrRes.id !== escrow.sellerAgentId) {
    return json({ ok: false, error: "Only seller agent can release" }, 403);
  }

  escrow.status = "released";
  escrow.proof = parsed.data.proof;
  escrow.updatedAt = new Date().toISOString();
  db.putEscrow(escrow);

  // On-chain release if contract is live
  let onChainResult: { txHash?: string; hashScanUrl?: string; error?: string } | undefined;
  if (ESCROW_CONTRACT_ADDRESS) {
    const onChain = await onChainRelease(escrow.orderId);
    if (onChain.ok && onChain.txHash) {
      onChainResult = {
        txHash: onChain.txHash,
        hashScanUrl: hashScanUrl(onChain.txHash),
      };
      escrow.onChainRef = onChain.txHash;
      db.putEscrow(escrow);
    } else {
      onChainResult = { error: onChain.error };
    }
  }

  const order = db.getOrder(escrow.orderId);
  if (order) {
    order.status = "completed";
    order.result = {
      escrowId: escrow.id,
      released: true,
      proof: escrow.proof,
      onChain: onChainResult,
    };
    order.completedAt = new Date().toISOString();
    // Seller net after platform fee — surfaced on the order record.
    order.sellerAmount = Number(
      ((order.totalAmount || escrow.amount || 0) - (order.platformFee || 0)).toFixed(8)
    );
    db.putOrder(order);
    const seller = db.getAgent(escrow.sellerAgentId);
    if (seller) {
      seller.stats.sales += 1;
      seller.stats.success += 1;
      db.putAgent(seller);
    }
    // Platform internal ledger — credit seller on successful sale.
    // Credit the SELLER AMOUNT (total minus platform fee), not the full total.
    const sellerAmount = Number(
      ((order.totalAmount || escrow.amount || 0) - (order.platformFee || 0)).toFixed(8)
    );
    creditSale(escrow.sellerAgentId, sellerAmount > 0 ? sellerAmount : escrow.amount || 0, order.id);
  }

  audit("escrow.released", { escrowId: id, orderId: escrow.orderId, onChain: onChainResult });
  // Notify buyer + seller on successful release
  if (order?.buyerAgentId) {
    void notify.agent(order.buyerAgentId, "escrow_released", {
      escrowId: id,
      orderId: escrow.orderId,
      buyer: true,
    });
  }
  void notify.agent(escrow.sellerAgentId, "escrow_released", {
    escrowId: id,
    orderId: escrow.orderId,
  });
  return json({ ok: true, escrow, order, onChain: onChainResult });
}
