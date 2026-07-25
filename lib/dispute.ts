/**
 * Dispute Resolution System
 * 
 * Allows buyers to open disputes when they're unsatisfied with a service.
 * Disputes can be resolved by:
 * 1. Auto-refund (if seller doesn't respond in 24h)
 * 2. Seller refund (voluntary)
 * 3. Platform mediation (operator reviews evidence)
 * 
 * Flow:
 *   Buyer opens dispute → Seller responds → Resolution → Escrow updated
 */

import { db, newId } from "./store";
import type { EscrowRecord } from "./store-types";
import { log } from "./logger";

export type DisputeRecord = {
  id: string;
  orderId: string;
  escrowId: string;
  buyerAgentId: string;
  sellerAgentId: string;
  reason: string;
  description: string;
  status: "open" | "responded" | "resolved_refund" | "resolved_keep" | "auto_refunded" | "escalated";
  createdAt: string;
  updatedAt: string;
  // Seller response
  sellerResponse?: string;
  sellerRespondedAt?: string;
  // Resolution
  resolution?: "refund" | "keep" | "partial";
  resolutionNote?: string;
  resolvedAt?: string;
  resolvedBy?: "seller" | "buyer" | "platform" | "auto";
  // Evidence
  evidence?: { type: string; data: string }[];
};

// In-memory dispute store
const disputes = new Map<string, DisputeRecord>();

export function createDispute(opts: {
  orderId: string;
  escrowId: string;
  buyerAgentId: string;
  sellerAgentId: string;
  reason: string;
  description: string;
}): DisputeRecord {
  const now = new Date().toISOString();
  const dispute: DisputeRecord = {
    id: newId("dsp"),
    orderId: opts.orderId,
    escrowId: opts.escrowId,
    buyerAgentId: opts.buyerAgentId,
    sellerAgentId: opts.sellerAgentId,
    reason: opts.reason,
    description: opts.description,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };

  disputes.set(dispute.id, dispute);

  // Update escrow status
  const escrow = db.getEscrow(opts.escrowId);
  if (escrow) {
    escrow.status = "disputed";
    escrow.updatedAt = now;
    db.putEscrow(escrow);
  }

  log.info({
    disputeId: dispute.id,
    orderId: opts.orderId,
    escrowId: opts.escrowId,
    reason: opts.reason,
  }, "Dispute opened");

  return dispute;
}

export function respondToDispute(
  disputeId: string,
  sellerAgentId: string,
  response: string
): DisputeRecord | null {
  const dispute = disputes.get(disputeId);
  if (!dispute) return null;
  if (dispute.sellerAgentId !== sellerAgentId) return null;
  if (dispute.status !== "open") return null;

  dispute.sellerResponse = response;
  dispute.sellerRespondedAt = new Date().toISOString();
  dispute.status = "responded";
  dispute.updatedAt = new Date().toISOString();

  disputes.set(disputeId, dispute);
  log.info({ disputeId, sellerAgentId }, "Dispute responded");

  return dispute;
}

export function resolveDispute(
  disputeId: string,
  resolution: "refund" | "keep" | "partial",
  resolvedBy: "seller" | "buyer" | "platform",
  note?: string
): DisputeRecord | null {
  const dispute = disputes.get(disputeId);
  if (!dispute) return null;
  if (dispute.status === "resolved_refund" || dispute.status === "resolved_keep") return null;

  const now = new Date().toISOString();
  dispute.resolution = resolution;
  dispute.resolutionNote = note;
  dispute.resolvedAt = now;
  dispute.resolvedBy = resolvedBy;
  dispute.updatedAt = now;

  if (resolution === "refund") {
    dispute.status = "resolved_refund";
    // Refund escrow
    const escrow = db.getEscrow(dispute.escrowId);
    if (escrow) {
      escrow.status = "refunded";
      escrow.reason = "dispute_refund";
      escrow.updatedAt = now;
      db.putEscrow(escrow);
    }
  } else if (resolution === "keep") {
    dispute.status = "resolved_keep";
    // Release escrow to seller
    const escrow = db.getEscrow(dispute.escrowId);
    if (escrow) {
      escrow.status = "released";
      escrow.reason = "dispute_resolved_keep";
      escrow.updatedAt = now;
      db.putEscrow(escrow);
    }
  } else if (resolution === "partial") {
    dispute.status = "resolved_refund";
    // Partial refund (simplified: full refund for now)
    const escrow = db.getEscrow(dispute.escrowId);
    if (escrow) {
      escrow.status = "refunded";
      escrow.reason = "dispute_partial_refund";
      escrow.updatedAt = now;
      db.putEscrow(escrow);
    }
  }

  disputes.set(disputeId, dispute);
  log.info({ disputeId, resolution, resolvedBy }, "Dispute resolved");

  return dispute;
}

export function getDispute(disputeId: string): DisputeRecord | null {
  return disputes.get(disputeId) || null;
}

export function listDisputes(agentId?: string): DisputeRecord[] {
  const all = Array.from(disputes.values());
  if (agentId) {
    return all.filter(
      (d) => d.buyerAgentId === agentId || d.sellerAgentId === agentId
    );
  }
  return all;
}

/** Auto-refund disputes that have been open for more than 24 hours without seller response */
export function autoResolveStaleDisputes(): DisputeRecord[] {
  const now = Date.now();
  const staleDisputes = Array.from(disputes.values()).filter((d) => {
    if (d.status !== "open") return false;
    const created = new Date(d.createdAt).getTime();
    return now - created > 24 * 60 * 60 * 1000; // 24 hours
  });

  for (const dispute of staleDisputes) {
    const now_iso = new Date().toISOString();
    dispute.status = "auto_refunded";
    dispute.resolution = "refund";
    dispute.resolvedBy = "auto";
    dispute.resolutionNote = "Auto-refunded: seller did not respond within 24h";
    dispute.resolvedAt = now_iso;
    dispute.updatedAt = now_iso;

    const escrow = db.getEscrow(dispute.escrowId);
    if (escrow) {
      escrow.status = "refunded";
      escrow.reason = "dispute_auto_refund";
      escrow.updatedAt = now_iso;
      db.putEscrow(escrow);
    }

    disputes.set(dispute.id, dispute);
    log.info({ disputeId: dispute.id }, "Dispute auto-refunded (stale)");
  }

  return staleDisputes;
}
