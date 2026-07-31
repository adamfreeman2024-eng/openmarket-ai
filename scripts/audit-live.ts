/** Live smoke test for the Gold V2 audit engine against real public repos. */
import { auditPublicGithubRepo } from "../lib/code-audit";

async function main() {
  const repos = [
    "https://github.com/sherlock-project/sherlock",
    "https://github.com/expressjs/express",
  ];
  for (const repo of repos) {
    console.log(`\n=== ${repo} ===`);
    const r = await auditPublicGithubRepo(repo);
    console.log(
      `ok=${r.ok} pass=${r.pass} tier=${r.tier} score=${r.score}/100 files=${r.filesScanned} findings=${r.findings.length}`
    );
    console.log(`languages=${JSON.stringify(r.languages)}`);
    console.log(`breakdown=${JSON.stringify(r.breakdown)}`);
    for (const f of r.findings.slice(0, 8)) {
      console.log(`  [${f.severity}] ${f.file}: ${f.rule} — ${f.detail}`);
    }
    console.log(`summary: ${r.summary}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
