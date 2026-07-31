/**
 * Gold V2 audit engine — language-aware static security analysis.
 * Modeled on bandit (Python), semgrep (JS/TS), Slither-lite (Solidity).
 * SSRF-safe: GitHub API + raw.githubusercontent.com only.
 */

export type Severity = "critical" | "high" | "medium" | "low";

export type AuditFinding = {
  severity: Severity;
  file: string;
  rule: string;
  detail: string;
};

export type AuditBreakdown = {
  critical: number;
  high: number;
  medium: number;
  low: number;
};

export type AuditTier = "gold" | "silver" | "bronze";

export type AuditResult = {
  ok: boolean;
  pass: boolean;
  repository: string;
  commitSha?: string;
  filesScanned: number;
  findings: AuditFinding[];
  summary: string;
  score: number;
  tier: AuditTier;
  breakdown: AuditBreakdown;
  languages: Record<string, number>;
};

type Rule = {
  id: string;
  re: RegExp;
  detail: string;
  severity: Severity;
};

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 40,
  high: 20,
  medium: 8,
  low: 2,
};

const COMMON_RULES: Rule[] = [
  {
    id: "private_key_pem",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    detail: "PEM private key material in source",
    severity: "critical",
  },
  {
    id: "eth_private_key",
    re: /(?:private[_-]?key|secret[_-]?key)\s*[:=]\s*['"]0x[a-fA-F0-9]{64}['"]/,
    detail: "Likely hardcoded EVM private key",
    severity: "critical",
  },
  {
    id: "aws_access_key",
    re: /AKIA[0-9A-Z]{16}/,
    detail: "AWS access key ID",
    severity: "critical",
  },
  {
    id: "google_api_key",
    re: /AIza[0-9A-Za-z_-]{35}/,
    detail: "Google API key",
    severity: "high",
  },
  {
    id: "github_token",
    re: /ghp_[0-9A-Za-z]{36}/,
    detail: "GitHub personal access token",
    severity: "critical",
  },
  {
    id: "slack_token",
    re: /xox[baprs]-[0-9A-Za-z-]{10,}/,
    detail: "Slack token",
    severity: "high",
  },
  {
    id: "generic_secret_assign",
    re: /(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][^'"]{12,}['"]/i,
    detail: "Hardcoded secret-like assignment",
    severity: "high",
  },
  {
    id: "destructive_rm",
    re: /rm\s+-rf\s+\/(?:\s|$|['"])/,
    detail: "Destructive rm -rf /",
    severity: "critical",
  },
  {
    id: "sql_concat",
    re: /(?:SELECT|INSERT|UPDATE|DELETE)\s+[^;]{0,120}["'`]\s*\+/i,
    detail: "SQL built via string concatenation (injection risk)",
    severity: "high",
  },
];

const PYTHON_RULES: Rule[] = [
  {
    id: "py_pickle",
    re: /pickle\.(?:loads?|dumps?)\s*\(/,
    detail: "pickle deserialization (RCE risk)",
    severity: "critical",
  },
  {
    id: "py_yaml_unsafe",
    re: /yaml\.unsafe_load\s*\(/,
    detail: "Unsafe YAML deserialization",
    severity: "critical",
  },
  {
    id: "py_yaml_load",
    re: /yaml\.load\s*\(/,
    detail: "yaml.load without explicit safe Loader",
    severity: "high",
  },
  {
    id: "py_subprocess_shell",
    re: /subprocess\.(?:call|run|Popen|check_call|check_output)\s*\([^)]*\bshell\s*=\s*True/i,
    detail: "subprocess with shell=True",
    severity: "high",
  },
  {
    id: "py_os_system",
    re: /\bos\.system\s*\(/,
    detail: "os.system shell call",
    severity: "high",
  },
  {
    id: "py_eval",
    re: /\beval\s*\(/,
    detail: "eval() of dynamic code",
    severity: "high",
  },
  {
    id: "py_exec",
    re: /\bexec\s*\(/,
    detail: "exec() of dynamic code",
    severity: "high",
  },
  {
    id: "py_flask_debug",
    re: /(?:app|Flask)\.run\s*\([^)]*\bdebug\s*=\s*True/i,
    detail: "Flask debug mode enabled",
    severity: "high",
  },
  {
    id: "py_ssti",
    re: /render_template_string\s*\(/,
    detail: "Jinja2 template injection risk",
    severity: "medium",
  },
  {
    id: "py_weak_hash",
    re: /hashlib\.(?:md5|sha1)\s*\(/,
    detail: "Weak hash (MD5/SHA1)",
    severity: "medium",
  },
  {
    id: "py_tempfile_mktemp",
    re: /tempfile\.mktemp\s*\(/,
    detail: "Insecure temp file creation",
    severity: "medium",
  },
  {
    id: "py_assert",
    re: /^\s*assert\s+/m,
    detail: "assert used (disabled under -O)",
    severity: "low",
  },
  {
    id: "py_bare_except",
    re: /^\s*except\s*:/m,
    detail: "Bare except clause",
    severity: "low",
  },
];

const JS_RULES: Rule[] = [
  {
    id: "js_dangerous_html",
    re: /dangerouslySetInnerHTML/,
    detail: "React dangerouslySetInnerHTML (XSS risk)",
    severity: "high",
  },
  {
    id: "js_inner_html",
    re: /\.innerHTML\s*=/,
    detail: "innerHTML assignment (XSS risk)",
    severity: "medium",
  },
  {
    id: "js_document_write",
    re: /document\.write\s*\(/,
    detail: "document.write (XSS risk)",
    severity: "medium",
  },
  {
    id: "js_eval",
    re: /\beval\s*\(/,
    detail: "eval() of dynamic code",
    severity: "high",
  },
  {
    id: "js_new_function",
    re: /new\s+Function\s*\(/,
    detail: "new Function() code execution",
    severity: "high",
  },
  {
    id: "js_child_process_exec",
    re: /child_process\.(?:exec|execSync)\s*\(/,
    detail: "child_process exec with shell",
    severity: "high",
  },
  {
    id: "js_child_process",
    re: /child_process/,
    detail: "child_process usage",
    severity: "medium",
  },
  {
    id: "js_proto_pollution",
    re: /__proto__|constructor\.prototype/,
    detail: "Prototype pollution pattern",
    severity: "high",
  },
  {
    id: "js_postmessage_wildcard",
    re: /postMessage\s*\([^)]*['"]\*['"]/,
    detail: "postMessage to wildcard origin",
    severity: "low",
  },
];

const SOLIDITY_RULES: Rule[] = [
  {
    id: "sol_tx_origin",
    re: /\btx\.origin\b/,
    detail: "tx.origin authorization (phishing risk)",
    severity: "critical",
  },
  {
    id: "sol_delegatecall",
    re: /\bdelegatecall\b/,
    detail: "delegatecall (storage corruption risk)",
    severity: "critical",
  },
  {
    id: "sol_selfdestruct",
    re: /\b(?:selfdestruct|suicide)\s*\(/,
    detail: "selfdestruct",
    severity: "critical",
  },
  {
    id: "sol_unchecked_call",
    re: /\.call\s*\{[^}]*value/i,
    detail: "Unchecked external call with value",
    severity: "high",
  },
  {
    id: "sol_transfer",
    re: /\.transfer\s*\(/,
    detail: "transfer() gas limit issues",
    severity: "medium",
  },
  {
    id: "sol_send",
    re: /\.send\s*\(/,
    detail: "send() return value ignored risk",
    severity: "medium",
  },
  {
    id: "sol_assembly",
    re: /\bassembly\b/,
    detail: "Inline assembly",
    severity: "medium",
  },
  {
    id: "sol_timestamp",
    re: /\bblock\.timestamp\b/,
    detail: "Timestamp dependence",
    severity: "low",
  },
  {
    id: "sol_block_number",
    re: /\bblock\.number\b/,
    detail: "Block number dependence",
    severity: "low",
  },
];

function detectLanguage(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".py") || p.endsWith(".pyi")) return "python";
  if (p.endsWith(".js") || p.endsWith(".jsx") || p.endsWith(".mjs") || p.endsWith(".cjs"))
    return "javascript";
  if (p.endsWith(".ts") || p.endsWith(".tsx")) return "typescript";
  if (p.endsWith(".sol")) return "solidity";
  if (p.endsWith(".go")) return "go";
  if (p.endsWith(".rs")) return "rust";
  if (p.endsWith(".sh") || p.endsWith(".bash")) return "shell";
  if (p.endsWith(".yml") || p.endsWith(".yaml")) return "yaml";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".env") || p === ".env") return "env";
  return "other";
}

function rulesFor(lang: string): Rule[] {
  const base = COMMON_RULES;
  if (lang === "python") return [...base, ...PYTHON_RULES];
  if (lang === "javascript" || lang === "typescript") return [...base, ...JS_RULES];
  if (lang === "solidity") return [...base, ...SOLIDITY_RULES];
  return base;
}

/**
 * Scan a single file's text content against language-aware rules.
 * Exported for unit testing without network access.
 */
export function scanText(path: string, text: string): AuditFinding[] {
  const lang = detectLanguage(path);
  const findings: AuditFinding[] = [];

  if (lang === "env" && !path.endsWith(".example") && !path.endsWith(".sample")) {
    findings.push({
      severity: "high",
      file: path,
      rule: "env_file_committed",
      detail: "Environment file committed to repository",
    });
  }

  for (const rule of rulesFor(lang)) {
    if (rule.re.test(text)) {
      findings.push({
        severity: rule.severity,
        file: path,
        rule: rule.id,
        detail: rule.detail,
      });
    }
  }
  return findings;
}

export function computeScore(findings: AuditFinding[]): number {
  const total = findings.reduce((s, f) => s + SEVERITY_WEIGHT[f.severity], 0);
  return Math.max(0, 100 - total);
}

export function tierFor(score: number, findings: AuditFinding[]): AuditTier {
  const hasCriticalHigh = findings.some(
    (f) => f.severity === "critical" || f.severity === "high"
  );
  if (hasCriticalHigh) return "bronze";
  if (score >= 85) return "gold";
  if (score >= 65) return "silver";
  return "bronze";
}

export function breakdownFor(findings: AuditFinding[]): AuditBreakdown {
  const b: AuditBreakdown = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) b[f.severity] += 1;
  return b;
}

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
  ".pyi",
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
      score: 0,
      tier: "bronze",
      breakdown: { critical: 0, high: 0, medium: 0, low: 0 },
      languages: {},
    };
  }
  const { owner, repo } = parsed;
  const repository = `https://github.com/${owner}/${repo}`;

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "AgentBazaar-GoldAudit/2.0",
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
      score: 0,
      tier: "bronze",
      breakdown: { critical: 0, high: 0, medium: 0, low: 0 },
      languages: {},
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
      score: 0,
      tier: "bronze",
      breakdown: { critical: 0, high: 0, medium: 0, low: 0 },
      languages: {},
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
      score: 0,
      tier: "bronze",
      breakdown: { critical: 0, high: 0, medium: 0, low: 0 },
      languages: {},
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
      score: 0,
      tier: "bronze",
      breakdown: { critical: 0, high: 0, medium: 0, low: 0 },
      languages: {},
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
  const languages: Record<string, number> = {};
  let scanned = 0;

  for (const f of files) {
    const path = f.path!;
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    try {
      const rawRes = await fetch(rawUrl, {
        headers: { "User-Agent": "AgentBazaar-GoldAudit/2.0" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!rawRes.ok) continue;
      const text = await rawRes.text();
      scanned += 1;
      const lang = detectLanguage(path);
      languages[lang] = (languages[lang] || 0) + 1;
      findings.push(...scanText(path, text));
    } catch {
      // skip file
    }
  }

  const score = computeScore(findings);
  const tier = tierFor(score, findings);
  const breakdown = breakdownFor(findings);
  const pass = tier === "gold";

  const summary = pass
    ? `PASS — ${tier.toUpperCase()} (${score}/100), scanned ${scanned} files, ${findings.length} finding(s)`
    : scanned === 0
      ? "FAIL — no scannable source files found"
      : `FAIL — ${tier.toUpperCase()} (${score}/100), ${findings.length} finding(s) in ${scanned} files`;

  return {
    ok: true,
    pass,
    repository,
    commitSha: treeJson.sha,
    filesScanned: scanned,
    findings: findings.slice(0, 50),
    summary,
    score,
    tier,
    breakdown,
    languages,
  };
}
