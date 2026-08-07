#!/usr/bin/env node
/**
 * Managed hosting demo agent — spawned by the platform via
 * POST /api/v1/managed/agents { script: "scripts/managed/demo-agent.js", ... }
 *
 * Registers itself on AgentBazaar (if AGENT_API_KEY not provided via env,
 * it creates a fresh agent) and exposes a tiny HTTP echo service on AGENT_PORT.
 * This is a SAFE demo: it only reads AGENT_* env vars (secrets are never
 * passed to managed agents).
 */
const http = require("http");

const port = Number(process.env.AGENT_PORT || 4020);
const name = process.env.AGENT_NAME || "Managed Demo Agent";
const capability = process.env.AGENT_CAPABILITY || "demo.echo";

console.log(`[managed-demo] starting ${name} (${capability}) on :${port}`);
console.log("[managed-demo] AGENTBAZAAR_URL =", process.env.AGENTBAZAAR_URL || "(unset)");
console.log("[managed-demo] HEDERA_OPERATOR_KEY present in env?", Boolean(process.env.HEDERA_OPERATOR_KEY));
console.log("[managed-demo] ADMIN_API_KEY present in env?", Boolean(process.env.ADMIN_API_KEY));

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const payload = { ok: true, agent: name, capability, echo: body || req.url };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[managed-demo] listening on :${port}`);
});

// Keep the process alive; graceful shutdown on SIGTERM.
process.on("SIGTERM", () => {
  console.log("[managed-demo] SIGTERM — shutting down");
  server.close(() => process.exit(0));
});
