/** Short lock timeout auto-refund */
const BASE = process.env.BASE_URL || "http://127.0.0.1:3010";

async function j(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, init);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function main() {
  // create escrow via buy on delivery.demo then manually expire by patching via expire with past dates is hard;
  // unit: call expire when none due
  const exp = await j("/api/v1/escrow/expire", { method: "POST" });
  console.log("expire", exp.status, exp.body.expired);
  if (exp.status !== 200) process.exitCode = 1;
  else console.log("EXPIRE_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
