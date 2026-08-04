import { NextRequest } from "next/server";
import { db, ensureSeedCatalog, audit } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import { findTokenInGithubGists, getVerificationStatus } from "@/lib/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * POST /api/v1/agents/me/github/verify
 * Completes Silver tier after public Gist contains the initiate token.
 */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const rl = await redisRateLimit(`github-verify:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  if (getVerificationStatus(agent) === "gold") {
    return json({
      ok: true,
      verificationStatus: "gold",
      githubHandle: agent.githubHandle,
      message: "Already Gold tier",
    });
  }

  if (getVerificationStatus(agent) === "silver" && agent.githubHandle) {
    return json({
      ok: true,
      alreadyVerified: true,
      verificationStatus: "silver",
      githubHandle: agent.githubHandle,
      message: "Already Silver tier",
    });
  }

  const handle = agent.githubHandle;
  const token = agent.githubVerificationToken;
  if (!handle || !token) {
    return json(
      {
        ok: false,
        error:
          "Verification not initiated. Call POST /api/v1/agents/me/github/initiate first.",
      },
      400
    );
  }

  const found = await findTokenInGithubGists(handle, token);
  if (!found.ok) {
    return json(
      {
        ok: false,
        error: found.error,
        githubHandle: handle,
      },
      400
    );
  }

  const updated = {
    ...agent,
    verificationStatus: "silver" as const,
    githubHandle: handle,
    githubVerificationToken: null,
  };
  db.putAgent(updated);
  audit("agent.github_verified", {
    agentId: agent.id,
    githubHandle: handle,
    verificationStatus: "silver",
  });

  return json({
    ok: true,
    verificationStatus: "silver",
    githubHandle: handle,
    message: "GitHub verified. Agent upgraded to Silver tier.",
  });
}
