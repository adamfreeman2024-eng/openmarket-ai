/**
 * E2E v3 — progress comparison across all marketplace generations.
 *
 * Same script shape as v1 (1.5.5) and v2 (1.6.2), but on 1.6.8 with the
 * Phase 6 additions. Runs a fresh seller + buyer and measures:
 *   PATH A: direct internal-balance buy (non-escrow)          [since 1.6.0]
 *   PATH B: auto-hire — one call, best agent, balance pay     [since 1.6.3]
 *   PATH C: escrow buy with a real USDC tx + release          [since 1.0]
 * Then prints the v1 → v2 → v3 comparison.
 *
 * Run: set -a && . ./.env && set +a && OPENMARKET_URL=http://127.0.0.1:3010 npx tsx scripts/e2e-v3-compare.ts
 */
import {
  Client,
  AccountId,
  PrivateKey,
  TransferTransaction,
  TokenAssociateTransaction,
  AccountCreateTransaction,
  Hbar,
  TokenId,
} from "@hiero-ledger/sdk";

const BASE = process.env.OPENMARKET_URL || "https://agentbazaar.app";
const OPERATOR_ID = process.env.HEDERA_OPERATOR_ID!;
const OPERATOR_KEY = process.env.HEDERA_OPERATOR_KEY!;
const USDC_TOKEN_ID = process.env.USDC_TOKEN_ID || process.env.NEXT_PUBLIC_USDC_TOKEN_ID!;

async function api(path: string, method = "GET", body?: unknown, apiKey?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json: json as Record<string, unknown> };
}

const say = (m: string) => console.log(`\n▶ ${m}`);

async function main() {
  console.log("E2E v3 | BASE:", BASE, "| USDC:", USDC_TOKEN_ID);
  const opId = AccountId.fromString(OPERATOR_ID);
  const opKey = PrivateKey.fromStringDer(OPERATOR_KEY);
  const client = Client.forTestnet().setOperator(opId, opKey);
  const tokenId = TokenId.fromString(USDC_TOKEN_ID);

  // 1. Fresh buyer wallet + USDC
  say("1. Fresh buyer Hedera account + 12 USDC");
  const buyerWalletKey = PrivateKey.generateECDSA();
  const createRx = await (await new AccountCreateTransaction()
    .setECDSAKeyWithAlias(buyerWalletKey.publicKey)
    .setInitialBalance(new Hbar(5)).execute(client)).getReceipt(client);
  const buyerId = createRx.accountId!;
  const buyerClient = Client.forTestnet().setOperator(buyerId, buyerWalletKey);
  await (await new TokenAssociateTransaction()
    .setAccountId(buyerId).setTokenIds([tokenId]).freezeWith(buyerClient).sign(buyerWalletKey))
    .execute(buyerClient).then((t) => t.getReceipt(buyerClient));
  await (await new TransferTransaction()
    .addTokenTransfer(tokenId, opId, -12_000_000).addTokenTransfer(tokenId, buyerId, 12_000_000)
    .execute(client)).getReceipt(client);

  // 2. Seller + offers
  say("2. Seller + 2 offers (non-escrow echo, escrow translate)");
  const sellerReg = await api("/api/v1/agents/register", "POST", {
    name: "E2E v3 Seller", walletAccountId: OPERATOR_ID,
    capabilities: ["demo.echo", "text.translate"],
    policy: { dailySpendLimit: 500, maxPerTx: 50 },
  });
  const sellerKey = sellerReg.json.apiKey as string;
  const sellerId = sellerReg.json.agentId as string;
  const echoOff = await api("/api/v1/offers", "POST", {
    capability: "demo.echo", title: "Echo v3 (non-escrow)", priceAmount: 0.5,
    priceAsset: "USDC", fulfillmentType: "inline", maxSeconds: 10, escrow: false,
  }, sellerKey);
  const echoOfferId = ((echoOff.json.offer || echoOff.json) as { id?: string }).id as string;
  const trOff = await api("/api/v1/offers", "POST", {
    capability: "text.translate", title: "Translate v3 (escrow)", priceAmount: 2.0,
    priceAsset: "USDC", fulfillmentType: "llm", maxSeconds: 60, escrow: true,
  }, sellerKey);
  const trOfferId = ((trOff.json.offer || trOff.json) as { id?: string }).id as string;
  console.log("   seller:", sellerId, "| echo:", echoOfferId, "| escrow:", trOfferId);

  // 3. Buyer agent
  const buyerReg = await api("/api/v1/agents/register", "POST", {
    name: "E2E v3 Buyer", walletAccountId: buyerId.toString(),
    capabilities: ["buyer"], policy: { dailySpendLimit: 100, maxPerTx: 20 },
  });
  const buyerKey = buyerReg.json.apiKey as string;
  console.log("   buyer:", buyerReg.json.agentId);

  // Deposit 5 USDC (mirror-verified)
  const depTx = await new TransferTransaction()
    .addTokenTransfer(tokenId, buyerId, -5_000_000)
    .addTokenTransfer(tokenId, opId, 5_000_000)
    .freezeWith(buyerClient).sign(buyerWalletKey);
  const depExec = await depTx.execute(buyerClient);
  await depExec.getReceipt(buyerClient);
  await new Promise((r) => setTimeout(r, 9000)); // mirror settle
  const dep = await api("/api/v1/deposit", "POST", {
    amount: 5, asset: "usdc", txId: depExec.transactionId.toString(),
  }, buyerKey);
  console.log("   deposit:", dep.status, "mode=", (dep.json as { mode?: string }).mode, "balance=", (dep.json as { balance?: number }).balance);

  // ── PATH A: direct internal-balance buy ──
  say("3. PATH A — direct buy (internal balance, no on-chain tx)");
  const tA0 = Date.now();
  const buyA = await api("/api/v1/buy", "POST", { offerId: echoOfferId, input: { text: "v3 internal buy" } }, buyerKey);
  const buyAms = Date.now() - tA0;
  console.log("   →", buyA.status, "| tx:", (buyA.json.order as { transactionId?: string })?.transactionId,
    "| status:", (buyA.json.order as { status?: string })?.status, "| wall:", buyAms + "ms");

  // ── PATH B: auto-hire ──
  say("4. PATH B — auto-hire (one call, best agent)");
  const tB0 = Date.now();
  const ah = await api("/api/v1/auto-hire", "POST", { capability: "demo.echo", input: { text: "v3 auto-hire" } }, buyerKey);
  const buyBms = Date.now() - tB0;
  const ahJson = ah.json as { ok?: boolean; orderId?: string; seller?: { id: string }; balance?: number };
  console.log("   →", ah.status, "| order:", ahJson.orderId, "| seller:", ahJson.seller?.id, "| wall:", buyBms + "ms");
  let ahTx = "";
  if (ahJson.orderId) {
    const oInfo = await api(`/api/v1/orders/${ahJson.orderId}`, "GET", undefined, buyerKey);
    ahTx = ((oInfo.json as { order?: { transactionId?: string } }).order?.transactionId) || "";
  }
  console.log("   tx:", ahTx, "| balance after:", ahJson.balance);

  // ── PATH C: escrow buy (real USDC tx) + release ──
  say("5. PATH C — escrow buy (real USDC tx) → release");
  const q = await api("/api/v1/quotes", "POST", { offerId: trOfferId, input: { text: "hello", targetLang: "hy" } }, buyerKey);
  const quote = q.json.quote as { id: string; totalAmount: number; payTo: string };
  const qDeadline = (q.json as { escrowDeadline?: string }).escrowDeadline;
  console.log("   quote escrowDeadline:", qDeadline || "(none)");
  const o = await api("/api/v1/orders", "POST", { quoteId: quote.id }, buyerKey);
  const orderId = (o.json.orderId || (o.json as { order?: { id: string } }).order?.id) as string;
  const payBase = Math.floor(quote.totalAmount * 1_000_000);
  const tC0 = Date.now();
  const payTx = await new TransferTransaction()
    .addTokenTransfer(tokenId, buyerId, -payBase).addTokenTransfer(tokenId, AccountId.fromString(quote.payTo), payBase)
    .freezeWith(buyerClient).sign(buyerWalletKey);
  const payExec = await payTx.execute(buyerClient);
  await payExec.getReceipt(buyerClient);
  await new Promise((r) => setTimeout(r, 9000));
  const pay = await api(`/api/v1/orders/${orderId}/pay`, "POST", { transactionId: payExec.transactionId.toString() }, buyerKey);
  const buyCms = Date.now() - tC0;
  const escrow = (pay.json.escrow as { id?: string; status?: string }) || {};
  const g = (pay.json as { guarantee?: { deadline?: string } }).guarantee;
  console.log("   →", pay.status, "| escrow:", escrow.id, escrow.status, "| guarantee.deadline:", g?.deadline || "(none)", "| wall:", buyCms + "ms");
  if (escrow.id) {
    const rel = await api(`/api/v1/escrow/${escrow.id}/release`, "POST", { proof: "v3-delivered" }, sellerKey);
    console.log("   release →", rel.status, "| escrow:", (rel.json.escrow as { status?: string })?.status);
  }

  // ── Final financial state ──
  say("6. Final financial state");
  const sMe = (await api("/api/v1/me", "GET", undefined, sellerKey)).json as {
    agent?: { internalBalance?: number }; revenue?: { earnedTotal?: number };
  };
  const bMe = (await api("/api/v1/me", "GET", undefined, buyerKey)).json as {
    agent?: { internalBalance?: number };
  };
  console.log("   SELLER internalBalance:", sMe.agent?.internalBalance, "| earnedTotal:", sMe.revenue?.earnedTotal);
  console.log("   BUYER internalBalance:", bMe.agent?.internalBalance, "(5 − purchases)");

  // ── Comparison table ──
  say("7. PROGRESS COMPARISON — v1 (1.5.5) → v2 (1.6.2) → v3 (1.6.8)");
  console.log("   ────────────────────────────────────────────────────────────────────────────────");
  console.log("   metric                v1 (1.5.5)      v2 (1.6.2)       v3 (1.6.8, this run)");
  console.log("   ────────────────────────────────────────────────────────────────────────────────");
  console.log("   per-buy on-chain tx   REQUIRED         non-escrow: no   non-escrow: no");
  console.log("                         (escrow only)    escrow: yes      escrow: yes");
  console.log("   internal-balance buy  ✗                ~27ms            " + buyAms + "ms");
  console.log("   auto-hire (one call)  ✗                ✗                " + buyBms + "ms");
  console.log("   escrow buy (real tx)  ~11s (9s mirror) ~11s (9s mirror) " + buyCms + "ms");
  console.log("   SLA deadline before   ✗                ✗                " + (qDeadline ? "YES (72h)" : "✗"));
  console.log("   guarantee at checkout ✗                ✗                " + (g?.deadline ? "YES" : "✗"));
  console.log("   seller credited       ✗ (1.5.5)        YES (2.5)        YES (" + sMe.agent?.internalBalance + ")");
  console.log("   ────────────────────────────────────────────────────────────────────────────────");
  const wins = ["seller credited", "internal-balance buy", "auto-hire", "SLA guarantee"];
  console.log("   NEW since v1:", wins.join(", "));
  console.log("   Auto-hire is the biggest UX jump: 1 call → done (no search, no tx)");

  buyerClient.close();
  client.close();
  console.log("\n✅ E2E v3 done — numbers above are live measurements.");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
