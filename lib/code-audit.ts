/**
 * Lightweight Gold-tier static audit of a public GitHub repository.
 * No arbitrary URL fetch (SSRF-safe): GitHub API + raw.githubusercontent.com only.
 */
export type AuditFinding = {
  severity: "critical" | "high" | "medium" | "low";
  file: string;
  rule: string;
  detail: string;
};

export type AuditResult = {
  ok: boolean;
  pass: boolean;
  repository: string;
  commitSha?: string;
  filesScanned: number;
  findings: AuditFinding[];
  summary: string;
};

const CRITICAL_RULES: Array<{ id: string; re: RegExp; detail: string }> = [
  {
    id: "private_key_pem",
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    detail: "PEM private key material in source",
  },
  {
    id: "eth_private_key",
    re: /(?:private[_-]?key|secret[_-]?key)\s*[:=]\s*['\"]0x[a-fA-F0-9]{64}['\"]/,
    detail: "Likely hardcoded EVM private key",
  },
  {
    id: "aws_key",
    re: /AKIA[0-9A-Z]{16}/,
    detail: "AWS access key id pattern",
  },
  {
    id: "generic_secret_assign",
    re: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{12,}['\"]/i,
    detail: "Hardcoded secret-like assignment",
  },
  {
    id: "shell_rm_rf",
    re: /rm\s+-rf\s+\/(?:\s|$|['\"])/,
    detail: "Destructive rm -rf /",
  },
  {
    id: "eval_use",
    re: /\beval\s*\(/,
    detail: "Use of eval()",
  },
  {
    id: "child_process_exec",
    re: /child_process|execSync\s*\(|exec\s*\(\s*[`'"].*\$\{/,
    detail: "Risky process execution pattern",
  },
];

function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url.trim());
    if (!["github.com", "www.github.com"].includes(u.hostname)) return null;
    const parts = u.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1];
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
      return null;
    }
    return { owner, repo };
  } catch {
    return null;
  }
}

const SCAN_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".sol",
  ".go",
  ".rs",
  ".env",
  ".yml",
  ".yaml",
  ".json",
  ".sh",
]);

export async function auditPublicGithubRepo(
  repositoryUrl: string
): Promise<AuditResult> {
  const parsed = parseGithubRepo(repositoryUrl);
  if (!parsed) {
    return {
      ok: false,
      pass: false,
      repository: repositoryUrl,
      filesScanned: 0,
      findings: [],
      summary: "Only public github.com owner/repo URLs are accepted",
    };
  }
  const { owner, repo } = parsed;
  const repository = `https://github.com/${owner}/${repo}`;

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "AgentBazaar-GoldAudit/1.0",
  };

  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (repoRes.status === 404) {
    return {
      ok: false,
      pass: false,
      repository,
      filesScanned: 0,
      findings: [],
      summary: "Repository not found or private",
    };
  }
  if (!repoRes.ok) {
    return {
      ok: false,
      pass: false,
      repository,
      filesScanned: 0,
      findings: [],
      summary: `GitHub API error ${repoRes.status}`,
    };
  }
  const repoJson = (await repoRes.json()) as {
    default_branch?: string;
    private?: boolean;
  };
  if (repoJson.private) {
    return {
      ok: false,
      pass: false,
      repository,
      filesScanned: 0,
      findings: [],
      summary: "Repository is private",
    };
  }
  const branch = repoJson.default_branch || "main";

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers, signal: AbortSignal.timeout(20_000) }
  );
  if (!treeRes.ok) {
    return {
      ok: false,
      pass: false,
      repository,
      filesScanned: 0,
      findings: [],
      summary: `Failed to list tree (${treeRes.status})`,
    };
  }
  const treeJson = (await treeRes.json()) as {
    sha?: string;
    tree?: Array<{ path?: string; type?: string; size?: number }>;
  };
  const files = (treeJson.tree || [])
    .filter((t) => t.type === "blob" && t.path)
    .filter((t) => {
      const p = t.path!.toLowerCase();
      if (p.includes("node_modules/") || p.includes("dist/") || p.includes(".git/"))
        return false;
      const dot = p.lastIndexOf(".");
      const ext = dot >= 0 ? p.slice(dot) : "";
      return SCAN_EXT.has(ext) || p.endsWith("dockerfile");
    })
    .filter((t) => (t.size ?? 0) < 200_000)
    .slice(0, 40);

  const findings: AuditFinding[] = [];
  let scanned = 0;

  for (const f of files) {
    const path = f.path!;
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    try {
      const rawRes = await fetch(rawUrl, {
        headers: { "User-Agent": "AgentBazaar-GoldAudit/1.0" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!rawRes.ok) continue;
      const text = await rawRes.text();
      scanned += 1;
      for (const rule of CRITICAL_RULES) {
        if (rule.re.test(text)) {
          findings.push({
            severity: "critical",
            file: path,
            rule: rule.id,
            detail: rule.detail,
          });
        }
      }
    } catch {
      // skip file
    }
  }

  const critical = findings.filter(
    (f) => f.severity === "critical" || f.severity === "high"
  );
  const pass = scanned > 0 && critical.length === 0;
  const summary = pass
    ? `PASS — scanned ${scanned} files, 0 critical findings`
    : scanned === 0
      ? "FAIL — no scannable source files found"
      : `FAIL — ${critical.length} critical finding(s) in ${scanned} files`;

  return {
    ok: true,
    pass,
    repository,
    commitSha: treeJson.sha,
    filesScanned: scanned,
    findings: findings.slice(0, 50),
    summary,
  };
}
