import { NextRequest } from "next/server";
import { z } from "zod";
import { db, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { auditPublicGithubRepo } from "@/lib/code-audit";
import type { VerificationStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const Body = z.object({
  repositoryUrl: z.string().url().max(300),
});

/**
 * POST /api/v1/agents/me/audit
 * Gold tier: submit a public GitHub repo for a static security audit.
 * Agent-first: only the agent itself can trigger its own audit.
 */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return json(
      { ok: false, error: "repositoryUrl is required and must be a valid URL" },
      400
    );
  }

  const result = await auditPublicGithubRepo(parsed.data.repositoryUrl);
  if (!result.ok) {
    return json(
      {
        ok: false,
        error: result.summary,
        repository: result.repository,
      },
      400
    );
  }

  const current: VerificationStatus = agent.verificationStatus || "bronze";
  const next: VerificationStatus =
    result.pass ? "gold" : current === "gold" ? "gold" : current;

  const updated = {
    ...agent,
    auditRepositoryUrl: result.repository,
    lastAuditSummary: result.summary,
    lastAuditAt: new Date().toISOString(),
    verificationStatus: next,
  };
  db.putAgent(updated);
  audit("agent.gold_audit", {
    agentId: agent.id,
    repository: result.repository,
    pass: result.pass,
    filesScanned: result.filesScanned,
    findings: result.findings.length,
    commitSha: result.commitSha || null,
  });

  return json({
    ok: true,
    pass: result.pass,
    verificationStatus: next,
    repository: result.repository,
    commitSha: result.commitSha || null,
    filesScanned: result.filesScanned,
    findings: result.findings,
    summary: result.summary,
    message: result.pass
      ? "Gold tier granted — repository passed static audit."
      : "Audit found critical findings. Fix them and resubmit.",
  });
}
