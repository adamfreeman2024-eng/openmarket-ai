#!/usr/bin/env node
/**
 * Managed hosting full-loop demo — Phase 8.4
 *
 * Creates a managed agent on the live marketplace, starts it, creates an
 * offer bound to the agent (if API allows), then buys with a funded buyer.
 *
 * Usage:
 *   set -a && . ./.env && set +a
 *   OPENMARKET_URL=https://agentbazaar.app \
 *   ADMIN_API_KEY=… BUYER_API_KEY=… \
 *   node scripts/managed/full-loop-demo.mjs
 *
 * If BUYER_API_KEY is missing, registers a fresh buyer (needs deposit separately).
 */
const BASE = process.env.OPENMARKET_URL || process.env.SITE_URL || "https://agentbazaar.app";
const ADMIN = process.env.ADMIN_API_KEY || "";
const BUYER_KEY = process.env.BUYER_API_KEY || "";

async function api(path, method = "GET", body, key) {
  const headers = { "content-type": "application/json" };
  if (key) headers["x-api-key"] = key;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  console.log("Managed full-loop | BASE:", BASE);
  if (!ADMIN) {
    console.error("ADMIN_API_KEY required");
    process.exit(1);
  }

  // 1. Create managed agent (platform hosts the process)
  console.log("\n▶ 1. Create managed agent");
  const created = await api(
    "/api/v1/managed/agents",
    "POST",
    {
      name: "FullLoop Demo Seller",
      script: "scripts/managed/demo-agent.js",
      capability: "demo.echo",
      env: { AGENT_NAME: "FullLoopDemo" },
    },
    ADMIN
  );
  console.log("   →", created.status, JSON.stringify(created.json).slice(0, 240));
  const managedId =
    created.json?.agent?.id ||
    created.json?.id ||
    created.json?.managedId ||
    created.json?.managed?.id;
  if (!managedId) {
    console.error("No managed id — is MANAGED_HOSTING_ENABLED=true?");
    process.exit(1);
  }

  // 2. Ensure running
  console.log("\n▶ 2. Start managed agent");
  const started = await api(
    `/api/v1/managed/agents/${managedId}/start`,
    "POST",
    {},
    ADMIN
  );
  console.log("   →", started.status, started.json?.agent?.status || started.json?.status || started.json);

  // 3. Buyer
  let buyerKey = BUYER_KEY;
  if (!buyerKey) {
    console.log("\n▶ 3. Register buyer (no balance — buy may 402)");
    const reg = await api("/api/v1/agents/register", "POST", {
      name: "FullLoop Buyer",
      walletAccountId: "0.0.999777",
      capabilities: ["buyer"],
    });
    buyerKey = reg.json.apiKey;
    console.log("   buyer key set, agent", reg.json.agentId || reg.json.agent?.id);
    console.log("   ⚠ deposit USDC to this buyer for a completed buy");
  }

  // 4. Find non-escrow echo offer
  console.log("\n▶ 4. Search demo.echo");
  const search = await api("/api/v1/offers/search?capability=demo.echo&limit=5");
  const offer =
    (search.json.results || []).find((r) => r.offer && !r.offer.escrow)?.offer ||
    (search.json.results || [])[0]?.offer;
  console.log("   offer", offer?.id, offer?.title, "escrow=", offer?.escrow);

  if (offer && buyerKey) {
    console.log("\n▶ 5. Buy (internal balance if funded)");
    const buy = await api(
      "/api/v1/buy",
      "POST",
      { offerId: offer.id, input: { text: "full-loop-demo" } },
      buyerKey
    );
    console.log(
      "   →",
      buy.status,
      buy.json?.order?.status || buy.json?.code || buy.json?.error,
      buy.json?.order?.transactionId || ""
    );
  }

  // 5. Seller opt-in payout (if we have a linked agent key — skip if only admin)
  console.log("\n▶ 6. Optional auto-payout dry-run (admin)");
  const dry = await api(
    "/api/v1/admin/payouts/run",
    "POST",
    { dryRun: true, threshold: 0.01 },
    ADMIN
  );
  console.log("   →", dry.status, JSON.stringify(dry.json).slice(0, 200));

  console.log("\n✅ Managed full-loop demo finished");
  console.log("   managedId:", managedId);
  console.log("   Tip: DELETE /api/v1/managed/agents/" + managedId + " when done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
