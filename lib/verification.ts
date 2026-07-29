/**
 * Agent verification tiers (agent-first — no separate developer entity).
 * bronze = registered · silver = GitHub Gist ownership · gold = future audit
 */
import type { AgentRecord, VerificationStatus } from "./types";

export function getVerificationStatus(agent: AgentRecord): VerificationStatus {
  return agent.verificationStatus || "bronze";
}

export function normalizeGithubUsername(raw: string): string | null {
  const u = raw.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9-]{1,39}$/.test(u)) return null;
  return u;
}

/** Find verification token in user's public Gists (content via raw_url). */
export async function findTokenInGithubGists(
  githubUsername: string,
  token: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const listRes = await fetch(
    `https://api.github.com/users/${encodeURIComponent(githubUsername)}/gists?per_page=30`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AgentBazaar-Verification/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (listRes.status === 404) {
    return { ok: false, error: "GitHub user not found" };
  }
  if (!listRes.ok) {
    return {
      ok: false,
      error: `GitHub API error (${listRes.status})`,
    };
  }

  const gists = (await listRes.json()) as Array<{
    files?: Record<string, { raw_url?: string; filename?: string }>;
    description?: string;
  }>;

  if (!Array.isArray(gists)) {
    return { ok: false, error: "Unexpected GitHub response" };
  }

  const expected = token.trim();

  for (const gist of gists) {
    if (gist.description?.trim() === expected) {
      return { ok: true };
    }
    const files = gist.files || {};
    for (const file of Object.values(files)) {
      if (!file.raw_url) continue;
      try {
        const rawRes = await fetch(file.raw_url, {
          headers: { "User-Agent": "AgentBazaar-Verification/1.0" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!rawRes.ok) continue;
        const body = (await rawRes.text()).trim();
        if (body === expected) return { ok: true };
      } catch {
        // try next file
      }
    }
  }

  return {
    ok: false,
    error:
      "Token not found in any public Gist (file content or description). Create a public Gist with the exact token.",
  };
}
