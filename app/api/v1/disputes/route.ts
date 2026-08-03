import { NextRequest } from "next/server";
import { db, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { listDisputes, autoResolveStaleDisputes } from "@/lib/dispute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/disputes — list disputes (auth: only own; ?all=1 operator) */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  autoResolveStaleDisputes();

  const agentOrRes = requireAgent(req);
  const wantAll = req.nextUrl.searchParams.get("all") === "1";
  const isOperator = req.nextUrl.searchParams.get("all") === "1";

  if (isResponse(agentOrRes)) {
    // Unauthenticated: only public list of open disputes (no sensitive data)
    if (wantAll) return agentOrRes;
    const open = listDisputes().filter((d) => d.status === "open").map(pub);
    return json({ ok: true, disputes: open });
  }

  const agent = agentOrRes;
  if (isOperator && process.env.OPERATOR_API_KEY) {
    const key =
      req.headers.get("x-api-key") ||
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (key === process.env.OPERATOR_API_KEY) {
      return json({ ok: true, disputes: listDisputes().map(pub) });
    }
  }

  const mine = listDisputes(agent.id).map(pub);
  return json({ ok: true, disputes: mine });
}

function pub(d: {
  id: string;
  orderId: string;
  escrowId: string;
  buyerAgentId: string;
  sellerAgentId: string;
  reason: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  sellerResponse?: string;
  resolution?: string;
  resolutionNote?: string;
  resolvedBy?: string;
}) {
  return {
    id: d.id,
    orderId: d.orderId,
    escrowId: d.escrowId,
    buyerAgentId: d.buyerAgentId,
    sellerAgentId: d.sellerAgentId,
    reason: d.reason,
    status: d.status,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    sellerResponse: d.sellerResponse,
    resolution: d.resolution,
    resolutionNote: d.resolutionNote,
    resolvedBy: d.resolvedBy,
  };
}
