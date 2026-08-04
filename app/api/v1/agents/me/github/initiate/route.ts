import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { db, ensureSeedCatalog, audit } from "@/lib/store";
import {
  json,
  options,
  requireAgent,
  isResponse,
  readJsonBody,
} from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import { normalizeGithubUsername } from "@/lib/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/**
 * POST /api/v1/agents/me/github/initiate
 * Body: { "githubUsername": "octocat" }
 * Starts Silver-tier verification — returns a one-time token for a public Gist.
 */
export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const rl = await redisRateLimit(`github-init:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const data = (body.data || {}) as { githubUsername?: unknown };
  const username = normalizeGithubUsername(String(data.githubUsername || ""));
  if (!username) {
    return json(
      {
        ok: false,
        error:
          "Invalid githubUsername (1-39 chars, letters/digits/hyphen, optional leading @)",
      },
      400
    );
  }

  if (agent.verificationStatus === "gold") {
    return json({
      ok: true,
      alreadyVerified: true,
      verificationStatus: "gold",
      githubHandle: agent.githubHandle || username,
      message: "Agent already Gold tier",
    });
  }

  const verificationToken = `agentbazaar-verify-${nanoid(20)}`;
  const updated = {
    ...agent,
    githubHandle: username,
    githubVerificationToken: verificationToken,
    // stay bronze until verify succeeds
    verificationStatus: agent.verificationStatus === "silver" ? "silver" : "bronze",
  } as typeof agent;
  db.putAgent(updated);
  audit("agent.github_verify_init", {
    agentId: agent.id,
    githubHandle: username,
  });

  return json({
    ok: true,
    verificationStatus: updated.verificationStatus || "bronze",
    githubHandle: username,
    verificationToken,
    instructions: [
      "1. Create a NEW public GitHub Gist (https://gist.github.com)",
      `2. Paste this EXACT token as the file content (or Gist description): ${verificationToken}`,
      "3. POST /api/v1/agents/me/github/verify with the same X-Api-Key (no body required)",
      "4. On success your agent becomes Silver tier",
    ],
    verifyEndpoint: "/api/v1/agents/me/github/verify",
  });
}
