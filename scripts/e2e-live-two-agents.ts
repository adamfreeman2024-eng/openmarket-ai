/**
 * Live E2E — two fresh agents trade services on AgentBazaar (testnet).
 *
 * Flow:
 *   1. Create a fresh Hedera testnet buyer account (operator funds HBAR + USDC)
 *   2. Register a NEW seller agent → creates 3 service offers (translate, echo, review)
 *   3. Register a NEW buyer agent
 *   4. Buyer searches → quotes → orders → pays with real USDC transfer
 *   5. Escrow lifecycle: pay → locked → seller releases (delivery proof) → released
 *   6. Second order: buyer pays → checks fulfillment result
 *
 * Requires .env: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, USDC_TOKEN_ID (or NEXT_PUBLIC_*)
 * Run:   OPENMARKET_URL=https://agentbazaar.app npx tsx scripts/e2e-live-two-agents.ts
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

const BASE =
  process.env.OPENMARKET_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "http://127.0.0.1:3010";

const OPERATOR_ID = process.env.HEDERA_OPERATOR_ID!;
const OPERATOR_KEY = process.env.HEDERA_OPERATOR_KEY!;
const USDC_TOKEN_ID =
  process.env.USDC_TOKEN_ID || process.env.NEXT_PUBLIC_USDC_TOKEN_ID!;

async function api(
  path: string,
  method = "GET",
  body?: unknown,
  apiKey?: string
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json: json as Record<string, unknown> };
}

const say = (m: string) => console.log(`\n▶ ${m}`);

async function main() {
  if (!OPERATOR_ID || !OPERATOR_KEY || !USDC_TOKEN_ID) {
    throw new Error("Need HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, USDC_TOKEN_ID");
  }
  console.log("BASE:", BASE, "| USDC:", USDC_TOKEN_ID);

  const opId = AccountId.fromString(OPERATOR_ID);
  const opKey = PrivateKey.fromStringDer(OPERATOR_KEY);
  const client = Client.forTestnet().setOperator(opId, opKey);
  const tokenId = TokenId.fromString(USDC_TOKEN_ID);

  // ── 1. Fresh buyer wallet on testnet ──
  say("1. Creating fresh buyer Hedera account (testnet)…");
  const buyerWalletKey = PrivateKey.generateECDSA();
  const createRx = await (
    await new AccountCreateTransaction()
      .setECDSAKeyWithAlias(buyerWalletKey.publicKey)
      .setInitialBalance(new Hbar(5))
      .execute(client)
  ).getReceipt(client);
  const buyerId = createRx.accountId!;
  console.log("   buyer account:", buyerId.toString());

  const buyerClient = Client.forTestnet().setOperator(buyerId, buyerWalletKey);
  await (
    await new TokenAssociateTransaction()
      .setAccountId(buyerId)
      .setTokenIds([tokenId])
      .freezeWith(buyerClient)
      .sign(buyerWalletKey)
  )
    .execute(buyerClient)
    .then((t) => t.getReceipt(buyerClient));
  console.log("   buyer associated USDC");

  const fundAmount = 15_000_000; // 15 USDC
  await (
    await new TransferTransaction()
      .addTokenTransfer(tokenId, opId, -fundAmount)
      .addTokenTransfer(tokenId, buyerId, fundAmount)
      .execute(client)
  ).getReceipt(client);
  console.log("   buyer funded with 15 USDC");

  // ── 2. Seller agent + 3 service offers ──
  say("2. Registering SELLER agent (fresh)…");
  const sellerReg = await api("/api/v1/agents/register", "POST", {
    name: "E2E Service Seller",
    walletAccountId: OPERATOR_ID, // seller treasury = operator testnet account
    capabilities: ["text.translate", "demo.echo", "code.review"],
    policy: { dailySpendLimit: 500, maxPerTx: 50 },
  });
  const sellerKey = sellerReg.json.apiKey as string;
  console.log("   seller:", sellerReg.json.agentId, "| key:", sellerKey?.slice(0, 8) + "…", "| status:", sellerReg.status);

  const offers = [
    {
      capability: "text.translate",
      title: "Translate EN→HY (live E2E)",
      description: "Translate text from English to Armenian (LLM fulfillment)",
      priceAmount: 2.0,
      priceAsset: "USDC",
      fulfillmentType: "llm",
      maxSeconds: 60,
      escrow: true,
    },
    {
      capability: "demo.echo",
      title: "Echo service (live E2E)",
      description: "Echo back the input payload (inline fulfillment)",
      priceAmount: 0.5,
      priceAsset: "USDC",
      fulfillmentType: "inline",
      maxSeconds: 10,
      escrow: false,
    },
    {
      capability: "code.review",
      title: "Code review (live E2E)",
      description: "AI code review of a small snippet (LLM fulfillment)",
      priceAmount: 3.0,
      priceAsset: "USDC",
      fulfillmentType: "llm",
      maxSeconds: 90,
      escrow: true,
    },
  ];
  const offerIds: string[] = [];
  for (const o of offers) {
    const res = await api("/api/v1/offers", "POST", o, sellerKey);
    const off = (res.json.offer || res.json) as { id?: string };
    offerIds.push(off.id || "");
    console.log(`   offer [${o.capability}] → ${res.status} ${off.id}  $${o.priceAmount} ${o.priceAsset} escrow=${o.escrow}`);
  }

  // ── 3. Buyer agent ──
  say("3. Registering BUYER agent (fresh)…");
  const buyerReg = await api("/api/v1/agents/register", "POST", {
    name: "E2E Service Buyer",
    walletAccountId: buyerId.toString(),
    capabilities: ["buyer"],
    policy: { dailySpendLimit: 100, maxPerTx: 20 },
  });
  const buyerKey = buyerReg.json.apiKey as string;
  console.log("   buyer:", buyerReg.json.agentId, "| key:", buyerKey?.slice(0, 8) + "…");

  // ── 4. Search as buyer ──
  say("4. Buyer searches the marketplace…");
  const search = await api("/api/v1/offers/search?capability=text.translate&asset=USDC&limit=5");
  console.log("   search status:", search.status, "| results:", Array.isArray(search.json.results) ? search.json.results.length : 0);
  const myOffers = ((search.json.results as Array<{ offer: { id: string; title: string; priceAmount: number } }>) || [])
    .filter((r) => offerIds.includes(r.offer.id));
  console.log("   our E2E offers found in search:", myOffers.map((r) => `${r.offer.id} ($${r.offer.priceAmount})`).join(", ") || "none");

  // ── 5. Order 1: translate (escrow) — quote → order → pay → release ──
  say("5. Buyer buys TRANSLATE service (escrow order)…");
  const q1 = await api("/api/v1/quotes", "POST", { offerId: offerIds[0], input: { text: "Hello, how are you?", targetLang: "hy" } }, buyerKey);
  const quote1 = q1.json.quote as { id: string; totalAmount: number; payTo: string; priceAsset: string };
  console.log("   quote:", q1.status, "| total:", quote1?.totalAmount, quote1?.priceAsset, "| payTo:", quote1?.payTo);

  const o1 = await api("/api/v1/orders", "POST", { quoteId: quote1.id }, buyerKey);
  const order1 = (o1.json.orderId || (o1.json as { order?: { id: string } }).order?.id) as string;
  console.log("   order:", o1.status, order1);

  // Real USDC transfer buyer → payTo (operator treasury)
  const payTo = AccountId.fromString(quote1.payTo);
  const payBase = Math.floor(quote1.totalAmount * 1_000_000);
  const payTx = await new TransferTransaction()
    .addTokenTransfer(tokenId, buyerId, -payBase)
    .addTokenTransfer(tokenId, payTo, payBase)
    .freezeWith(buyerClient)
    .sign(buyerWalletKey);
  const payExec = await payTx.execute(buyerClient);
  await payExec.getReceipt(buyerClient);
  const txId1 = payExec.transactionId.toString();
  console.log("   USDC payment tx:", txId1);

  // Wait for mirror node
  await new Promise((r) => setTimeout(r, 9000));

  const pay1 = await api(`/api/v1/orders/${order1}/pay`, "POST", { transactionId: txId1 }, buyerKey);
  console.log("   pay/settle:", pay1.status, JSON.stringify(pay1.json).slice(0, 600));

  const escrow1 = (pay1.json.escrow as { id?: string; status?: string }) || {};
  console.log("   escrow:", escrow1.id, escrow1.status || "(none)");

  // Seller releases escrow with delivery proof
  if (escrow1.id) {
    say("5b. Seller releases escrow (delivery proof)…");
    const rel = await api(`/api/v1/escrow/${escrow1.id}/release`, "POST", { proof: "e2e-delivered-v1" }, sellerKey);
    console.log("   release:", rel.status, JSON.stringify(rel.json).slice(0, 300));
  }

  // ── 6. Order 2: echo (non-escrow, instant fulfillment) ──
  say("6. Buyer buys ECHO service (non-escrow, instant)…");
  const q2 = await api("/api/v1/quotes", "POST", { offerId: offerIds[1], input: { text: "ping-from-buyer" } }, buyerKey);
  const quote2 = q2.json.quote as { id: string; totalAmount: number; payTo: string };
  const o2 = await api("/api/v1/orders", "POST", { quoteId: quote2.id }, buyerKey);
  const order2 = (o2.json.orderId || (o2.json as { order?: { id: string } }).order?.id) as string;
  console.log("   quote:", quote2?.totalAmount, "| order:", order2);

  const payBase2 = Math.floor(quote2.totalAmount * 1_000_000);
  const payTx2 = await new TransferTransaction()
    .addTokenTransfer(tokenId, buyerId, -payBase2)
    .addTokenTransfer(tokenId, payTo, payBase2)
    .freezeWith(buyerClient)
    .sign(buyerWalletKey);
  const payExec2 = await payTx2.execute(buyerClient);
  await payExec2.getReceipt(buyerClient);
  const txId2 = payExec2.transactionId.toString();
  console.log("   USDC payment tx:", txId2);

  await new Promise((r) => setTimeout(r, 9000));

  const pay2 = await api(`/api/v1/orders/${order2}/pay`, "POST", { transactionId: txId2 }, buyerKey);
  console.log("   pay/settle:", pay2.status, JSON.stringify(pay2.json).slice(0, 700));

  // ── 7. Order 3: code review (escrow) ──
  say("7. Buyer buys CODE REVIEW service (escrow order)…");
  const q3 = await api("/api/v1/quotes", "POST", { offerId: offerIds[2], input: { code: "function add(a,b){return a+b}" } }, buyerKey);
  const quote3 = q3.json.quote as { id: string; totalAmount: number; payTo: string };
  const o3 = await api("/api/v1/orders", "POST", { quoteId: quote3.id }, buyerKey);
  const order3 = (o3.json.orderId || (o3.json as { order?: { id: string } }).order?.id) as string;
  console.log("   quote:", quote3?.totalAmount, "| order:", order3);

  const payBase3 = Math.floor(quote3.totalAmount * 1_000_000);
  const payTx3 = await new TransferTransaction()
    .addTokenTransfer(tokenId, buyerId, -payBase3)
    .addTokenTransfer(tokenId, payTo, payBase3)
    .freezeWith(buyerClient)
    .sign(buyerWalletKey);
  const payExec3 = await payTx3.execute(buyerClient);
  await payExec3.getReceipt(buyerClient);
  const txId3 = payExec3.transactionId.toString();
  console.log("   USDC payment tx:", txId3);

  await new Promise((r) => setTimeout(r, 9000));

  const pay3 = await api(`/api/v1/orders/${order3}/pay`, "POST", { transactionId: txId3 }, buyerKey);
  console.log("   pay/settle:", pay3.status, JSON.stringify(pay3.json).slice(0, 700));
  const escrow3 = (pay3.json.escrow as { id?: string; status?: string }) || {};
  console.log("   escrow:", escrow3.id, escrow3.status || "(none)");

  // ── 8. Seller reputation + order check ──
  say("8. Final state check…");
  const me = await api("/api/v1/me", "GET", undefined, sellerKey);
  console.log("   seller /me:", me.status, JSON.stringify(me.json).slice(0, 400));
  const ord = await api(`/api/v1/orders/${order1}`, "GET", undefined, buyerKey);
  console.log("   order1:", ord.status, (ord.json.order as { status?: string })?.status || JSON.stringify(ord.json).slice(0, 200));

  buyerClient.close();
  client.close();
  console.log("\n✅ E2E finished — inspect logs above for each step.");
}

main().catch((e) => {
  console.error("❌ E2E failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
