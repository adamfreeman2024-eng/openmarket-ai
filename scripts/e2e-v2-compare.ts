/**
 * E2E v2 comparison — "how much better is the marketplace now?"
 * Runs a fresh seller + buyer and does real purchases both ways:
 *
 *  PATH A (NEW, Phase 2.1): buyer deposits real USDC once → internal balance
 *    → buys NON-escrow offer with NO per-order on-chain tx (transactionId=internal:)
 *  PATH B (OLD): buyer pays each escrow order with a real USDC transfer
 *    → escrow lock → seller release
 *
 * Prints a side-by-side usability comparison. Requires .env operator keys.
 * Run: set -a && . ./.env && set +a && OPENMARKET_URL=https://agentbazaar.app npx tsx scripts/e2e-v2-compare.ts
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
  console.log("BASE:", BASE, "| USDC:", USDC_TOKEN_ID);
  const opId = AccountId.fromString(OPERATOR_ID);
  const opKey = PrivateKey.fromStringDer(OPERATOR_KEY);
  const client = Client.forTestnet().setOperator(opId, opKey);
  const tokenId = TokenId.fromString(USDC_TOKEN_ID);

  // 1. Fresh buyer wallet
  say("1. Fresh buyer Hedera account + USDC");
  const buyerWalletKey = PrivateKey.generateECDSA();
  const createRx = await (await new AccountCreateTransaction()
    .setECDSAKeyWithAlias(buyerWalletKey.publicKey)
    .setInitialBalance(new Hbar(5))
    .execute(client)).getReceipt(client);
  const buyerId = createRx.accountId!;
  const buyerClient = Client.forTestnet().setOperator(buyerId, buyerWalletKey);
  await (await new TokenAssociateTransaction()
    .setAccountId(buyerId).setTokenIds([tokenId]).freezeWith(buyerClient).sign(buyerWalletKey))
    .execute(buyerClient).then((t) => t.getReceipt(buyerClient));
  const fund = 12_000_000; // 12 USDC demo faucet
  await (await new TransferTransaction()
    .addTokenTransfer(tokenId, opId, -fund).addTokenTransfer(tokenId, buyerId, fund)
    .execute(client)).getReceipt(client);
  console.log("   buyer:", buyerId.toString(), "funded 12 USDC (demo faucet)");

  // 2. Seller + 2 offers (one non-escrow, one escrow)
  say("2. Seller agent + 2 offers");
  const sellerReg = await api("/api/v1/agents/register", "POST", {
    name: "E2E v2 Seller",
    walletAccountId: OPERATOR_ID,
    capabilities: ["demo.echo", "text.translate"],
    policy: { dailySpendLimit: 500, maxPerTx: 50 },
  });
  const sellerKey = sellerReg.json.apiKey as string;
  const sellerId = sellerReg.json.agentId as string;
  console.log("   seller:", sellerId);

  const echoOff = await api("/api/v1/offers", "POST", {
    capability: "demo.echo", title: "Echo (non-escrow)", priceAmount: 0.5,
    priceAsset: "USDC", fulfillmentType: "inline", maxSeconds: 10, escrow: false,
  }, sellerKey);
  const echoOfferId = ((echoOff.json.offer || echoOff.json) as { id?: string }).id as string;
  const trOff = await api("/api/v1/offers", "POST", {
    capability: "text.translate", title: "Translate (escrow)", priceAmount: 2.0,
    priceAsset: "USDC", fulfillmentType: "llm", maxSeconds: 60, escrow: true,
  }, sellerKey);
  const trOfferId = ((trOff.json.offer || trOff.json) as { id?: string }).id as string;
  console.log("   echo offer:", echoOfferId, "| translate offer:", trOfferId);

  // 3. Buyer agent
  say("3. Buyer agent");
  const buyerReg = await api("/api/v1/agents/register", "POST", {
    name: "E2E v2 Buyer",
    walletAccountId: buyerId.toString(),
    capabilities: ["buyer"],
    policy: { dailySpendLimit: 100, maxPerTx: 20 },
  });
  const buyerKey = buyerReg.json.apiKey as string;
  console.log("   buyer:", buyerReg.json.agentId);

  // ── PATH A: deposit once → internal balance → buy non-escrow with NO tx ──
  say("4. PATH A (NEW) — buyer deposits 5 USDC (one tx), then buys echo from balance");
  // Deposit: buyer → operator treasury, platform verifies on mirror and credits balance.
  const depositAmount = 5;
  const depTx = await new TransferTransaction()
    .addTokenTransfer(tokenId, buyerId, -Math.floor(depositAmount * 1_000_000))
    .addTokenTransfer(tokenId, opId, Math.floor(depositAmount * 1_000_000))
    .freezeWith(buyerClient).sign(buyerWalletKey);
  const depExec = await depTx.execute(buyerClient);
  await depExec.getReceipt(buyerClient);
  await new Promise((r) => setTimeout(r, 9000)); // mirror settle
  const dep = await api("/api/v1/deposit", "POST", {
    amount: depositAmount, asset: "usdc", txId: depExec.transactionId.toString(),
  }, buyerKey);
  console.log("   deposit:", dep.status, "| mode:", (dep.json as { mode?: string }).mode, "| balance:", (dep.json as { balance?: number }).balance);

  // Now buy echo — should complete with internal: tx, no second on-chain tx.
  const tA0 = Date.now();
  const buyA = await api("/api/v1/buy", "POST", {
    offerId: echoOfferId, input: { text: "internal-balance buy" },
  }, buyerKey);
  const buyAms = Date.now() - tA0;
  console.log("   buy echo →", buyA.status, "| tx:", (buyA.json.order as { transactionId?: string })?.transactionId, "| status:", (buyA.json.order as { status?: string })?.status, "| latency:", buyAms + "ms");

  // ── PATH B: old way — real USDC transfer per escrow order ──
  say("5. PATH B (OLD) — buyer pays translate with a real USDC transfer → escrow → release");
  const q = await api("/api/v1/quotes", "POST", { offerId: trOfferId, input: { text: "hello", targetLang: "hy" } }, buyerKey);
  const quote = q.json.quote as { id: string; totalAmount: number; payTo: string };
  const o = await api("/api/v1/orders", "POST", { quoteId: quote.id }, buyerKey);
  const orderId = (o.json.orderId || (o.json as { order?: { id: string } }).order?.id) as string;
  const payTo = AccountId.fromString(quote.payTo);
  const payBase = Math.floor(quote.totalAmount * 1_000_000);
  const tB0 = Date.now();
  const payTx = await new TransferTransaction()
    .addTokenTransfer(tokenId, buyerId, -payBase).addTokenTransfer(tokenId, payTo, payBase)
    .freezeWith(buyerClient).sign(buyerWalletKey);
  const payExec = await payTx.execute(buyerClient);
  await payExec.getReceipt(buyerClient);
  await new Promise((r) => setTimeout(r, 9000));
  const pay = await api(`/api/v1/orders/${orderId}/pay`, "POST", {
    transactionId: payExec.transactionId.toString(),
  }, buyerKey);
  const payBms = Date.now() - tB0;
  const escrow = (pay.json.escrow as { id?: string; status?: string }) || {};
  console.log("   pay →", pay.status, "| escrow:", escrow.id, escrow.status, "| wall:", payBms + "ms");
  if (escrow.id) {
    const rel = await api(`/api/v1/escrow/${escrow.id}/release`, "POST", { proof: "e2e-v2-delivered" }, sellerKey);
    console.log("   release →", rel.status, "| escrow:", (rel.json.escrow as { status?: string })?.status);
  }

  // ── Final state: seller balance + buyer balance ──
  say("6. Final financial state");
  const me = await api("/api/v1/me", "GET", undefined, sellerKey);
  const sMe = me.json as { agent?: { internalBalance?: number }; revenue?: { earnedTotal?: number } };
  console.log("   SELLER internalBalance:", sMe.agent?.internalBalance, "| earnedTotal:", sMe.revenue?.earnedTotal);
  const bMe = await api("/api/v1/me", "GET", undefined, buyerKey);
  console.log("   BUYER internalBalance:", (bMe.json as { agent?: { internalBalance?: number } }).agent?.internalBalance);

  // 7. Usability comparison (what changed)
  say("7. Side-by-side (vs first E2E on 1.5.5)");
  console.log("   ────────────────────────────────────────────────────────────────");
  console.log("   OLD (1.5.5)                              NEW (1.6.2)");
  console.log("   ────────────────────────────────────────────────────────────────");
  console.log("   every buy needs a real on-chain tx       ONE deposit fills internal balance");
  console.log("   buyer must know Hedera/USDC/wallet       buyer can buy from ledger balance");
  console.log("   seller balance never credited             seller internalBalance + earnedTotal live");
  console.log("   sellerAmount not shown on orders          order.sellerAmount + payoutStatus");
  console.log("   escrow lock/release                       escrow + release (unchanged, solid)");
  console.log("   ────────────────────────────────────────────────────────────────");
  console.log("   PATH A (internal balance) wall:", buyAms + "ms", "| PATH B (real tx) wall:", payBms + "ms (incl. 9s mirror wait)");

  buyerClient.close();
  client.close();
  console.log("\n✅ E2E v2 done — compare numbers above.");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
