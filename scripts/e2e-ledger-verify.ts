/**
 * Mini live E2E — proves seller internalBalance is credited on a real
 * USDC testnet sale and persisted (Postgres), 2026-08-07 (v1.5.9).
 *
 * Flow: register seller → echo offer → register buyer (real wallet) →
 * quote → order → real USDC transfer → pay → check seller /me balance.
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

async function main() {
  console.log("BASE:", BASE, "| USDC:", USDC_TOKEN_ID);
  const opId = AccountId.fromString(OPERATOR_ID);
  const opKey = PrivateKey.fromStringDer(OPERATOR_KEY);
  const client = Client.forTestnet().setOperator(opId, opKey);
  const tokenId = TokenId.fromString(USDC_TOKEN_ID);

  // 1. Fresh buyer wallet
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
  const fund = 5_000_000;
  await (await new TransferTransaction()
    .addTokenTransfer(tokenId, opId, -fund).addTokenTransfer(tokenId, buyerId, fund)
    .execute(client)).getReceipt(client);
  console.log("1. buyer wallet:", buyerId.toString(), "funded 5 USDC");

  // 2. Seller agent + echo offer (inline, non-escrow — fastest path)
  const sellerReg = await api("/api/v1/agents/register", "POST", {
    name: "Ledger Verify Seller",
    walletAccountId: OPERATOR_ID,
    capabilities: ["demo.echo"],
    policy: { dailySpendLimit: 100, maxPerTx: 10 },
  });
  const sellerKey = sellerReg.json.apiKey as string;
  const sellerId = sellerReg.json.agentId as string;
  console.log("2. seller:", sellerId);

  const offRes = await api("/api/v1/offers", "POST", {
    capability: "demo.echo",
    title: "Ledger verify echo",
    description: "Inline echo — ledger credit check",
    priceAmount: 0.5,
    priceAsset: "USDC",
    fulfillmentType: "inline",
    maxSeconds: 10,
    escrow: false,
  }, sellerKey);
  const offerId = ((offRes.json.offer || offRes.json) as { id?: string }).id as string;
  console.log("   offer:", offerId);

  // 3. Buyer agent
  const buyerReg = await api("/api/v1/agents/register", "POST", {
    name: "Ledger Verify Buyer",
    walletAccountId: buyerId.toString(),
    capabilities: ["buyer"],
    policy: { dailySpendLimit: 100, maxPerTx: 10 },
  });
  const buyerKey = buyerReg.json.apiKey as string;
  console.log("3. buyer:", buyerReg.json.agentId);

  // 4. Quote → order → real USDC transfer → pay
  const q = await api("/api/v1/quotes", "POST", { offerId, input: { text: "hi" } }, buyerKey);
  const quote = q.json.quote as { id: string; totalAmount: number; payTo: string };
  const o = await api("/api/v1/orders", "POST", { quoteId: quote.id }, buyerKey);
  const orderId = (o.json.orderId || (o.json as { order?: { id: string } }).order?.id) as string;
  console.log("4. order:", orderId, "total:", quote.totalAmount);

  const payTo = AccountId.fromString(quote.payTo);
  const payBase = Math.floor(quote.totalAmount * 1_000_000);
  const payTx = await new TransferTransaction()
    .addTokenTransfer(tokenId, buyerId, -payBase).addTokenTransfer(tokenId, payTo, payBase)
    .freezeWith(buyerClient).sign(buyerWalletKey);
  const payExec = await payTx.execute(buyerClient);
  await payExec.getReceipt(buyerClient);
  console.log("   tx:", payExec.transactionId.toString());
  await new Promise((r) => setTimeout(r, 9000));

  const pay = await api(`/api/v1/orders/${orderId}/pay`, "POST", { transactionId: payExec.transactionId.toString() }, buyerKey);
  console.log("   pay:", pay.status, JSON.stringify(pay.json).slice(0, 300));

  // 5. Verify seller balance
  const me = await api("/api/v1/me", "GET", undefined, sellerKey);
  console.log("5. seller /me balance:", (me.json.agent as { internalBalance?: number }).internalBalance);
  console.log("   order status:", (me.json.recentSellOrders as Array<{ id: string; status: string }>)?.map((x) => `${x.id}:${x.status}`).join(", "));

  const ok = (me.json.agent as { internalBalance?: number }).internalBalance === 0.5;
  console.log(ok ? "\n✅ LEDGER CREDIT VERIFIED (0.5 USDC)" : "\n❌ BALANCE NOT 0.5");
  buyerClient.close();
  client.close();
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
