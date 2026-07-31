/**
 * Unit tests for the Gold V2 audit engine (no network required).
 * Run: OM_DATA_DIR=/tmp/wf-test npx tsx scripts/unit-audit.ts
 */
import {
  scanText,
  computeScore,
  tierFor,
  breakdownFor,
  type AuditFinding,
} from "../lib/code-audit";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    console.error(`  \u2717 ${name}`, extra ?? "");
  }
}

function hasRule(findings: AuditFinding[], rule: string): boolean {
  return findings.some((f) => f.rule === rule);
}

console.log("Gold V2 audit engine — unit tests\n");

console.log("  --- language-aware rules ---");
check(
  "python: pickle -> critical",
  hasRule(scanText("app.py", "import pickle\npickle.loads(data)"), "py_pickle")
);
check(
  "python: subprocess shell=True -> high",
  hasRule(scanText("run.py", 'subprocess.run(cmd, shell=True)'), "py_subprocess_shell")
);
check(
  "python: os.system -> high",
  hasRule(scanText("x.py", "os.system('ls')"), "py_os_system")
);
check(
  "python: eval -> high",
  hasRule(scanText("x.py", "eval(user_input)"), "py_eval")
);
check(
  "python: weak hash -> medium",
  hasRule(scanText("x.py", "hashlib.md5(data).hexdigest()"), "py_weak_hash")
);
check(
  "python: clean code -> no findings",
  scanText("utils.py", "def add(a, b):\n    return a + b").length === 0
);

check(
  "js: dangerouslySetInnerHTML -> high",
  hasRule(scanText("App.tsx", "<div dangerouslySetInnerHTML={{__html: x}} />"), "js_dangerous_html")
);
check(
  "js: eval -> high",
  hasRule(scanText("app.js", "eval(code)"), "js_eval")
);
check(
  "js: child_process exec -> high",
  hasRule(scanText("server.js", "child_process.exec(cmd)"), "js_child_process_exec")
);
check(
  "js: innerHTML -> medium",
  hasRule(scanText("app.js", "el.innerHTML = html"), "js_inner_html")
);
check(
  "js: clean code -> no findings",
  scanText("util.ts", "export const sum = (a: number, b: number) => a + b;").length === 0
);

check(
  "solidity: tx.origin -> critical",
  hasRule(scanText("Vault.sol", "require(tx.origin == owner);"), "sol_tx_origin")
);
check(
  "solidity: delegatecall -> critical",
  hasRule(scanText("Proxy.sol", "(ok, ) = target.delegatecall(data);"), "sol_delegatecall")
);
check(
  "solidity: selfdestruct -> critical",
  hasRule(scanText("Kill.sol", "selfdestruct(payable(owner));"), "sol_selfdestruct")
);
check(
  "solidity: unchecked call with value -> high",
  hasRule(scanText("Pay.sol", "target.call{value: amount}(\"\");"), "sol_unchecked_call")
);
check(
  "solidity: transfer -> medium",
  hasRule(scanText("Pay.sol", "payable(to).transfer(amount);"), "sol_transfer")
);
check(
  "solidity: clean contract -> no findings",
  scanText("Token.sol", "contract Token {\n  uint256 public supply;\n  function mint() external { supply += 1; }\n}").length === 0
);

check(
  "common: PEM private key -> critical",
  hasRule(scanText("key.pem", "-----BEGIN RSA PRIVATE KEY-----\nMIIE"), "private_key_pem")
);
check(
  "common: github token -> critical",
  hasRule(scanText("config.json", '"token": "ghp_abcdefghijklmnopqrstuvwxyz0123456789"'), "github_token")
);
check(
  "common: hardcoded password -> high",
  hasRule(scanText("db.js", 'const password = "hunter2-secret-123";'), "generic_secret_assign")
);
check(
  "common: SQL concat -> high",
  hasRule(scanText("query.py", 'query = "SELECT * FROM users WHERE id = " + user_id'), "sql_concat")
);

console.log("\n  --- env files ---");
check(
  "env: committed .env -> high",
  hasRule(scanText(".env", "DATABASE_URL=postgres://user:pass@host/db"), "env_file_committed")
);
check(
  "env: .env.example -> no env_file_committed",
  !hasRule(scanText(".env.example", "DATABASE_URL=postgres://user:pass@host/db"), "env_file_committed")
);

console.log("\n  --- scoring & tiers ---");
const none: AuditFinding[] = [];
check("empty findings -> score 100", computeScore(none) === 100);
check("empty findings -> gold", tierFor(computeScore(none), none) === "gold");

const oneLow: AuditFinding[] = [
  { severity: "low", file: "a.py", rule: "py_assert", detail: "" },
];
check("1 low -> score 98", computeScore(oneLow) === 98);
check("1 low -> gold", tierFor(computeScore(oneLow), oneLow) === "gold");

const oneMed: AuditFinding[] = [
  { severity: "medium", file: "a.js", rule: "js_inner_html", detail: "" },
];
check("1 medium -> score 92", computeScore(oneMed) === 92);
check("1 medium -> gold (>=85)", tierFor(computeScore(oneMed), oneMed) === "gold");

const twoMed: AuditFinding[] = [
  { severity: "medium", file: "a.js", rule: "js_inner_html", detail: "" },
  { severity: "medium", file: "b.js", rule: "js_document_write", detail: "" },
];
check("2 medium -> score 84", computeScore(twoMed) === 84);
check("2 medium -> silver", tierFor(computeScore(twoMed), twoMed) === "silver");

const oneHigh: AuditFinding[] = [
  { severity: "high", file: "a.py", rule: "py_eval", detail: "" },
];
check("1 high -> bronze", tierFor(computeScore(oneHigh), oneHigh) === "bronze");

const critLow: AuditFinding[] = [
  { severity: "critical", file: "Vault.sol", rule: "sol_tx_origin", detail: "" },
  { severity: "low", file: "x.py", rule: "py_assert", detail: "" },
];
check("critical present -> score 58", computeScore(critLow) === 58);
check("critical present -> bronze", tierFor(computeScore(critLow), critLow) === "bronze");

const bd = breakdownFor(critLow);
check(
  "breakdown counts severities",
  bd.critical === 1 && bd.high === 0 && bd.medium === 0 && bd.low === 1
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
