/**
 * USDC settlement E2E on Hedera testnet.
 * 1) Transfer USDC (HTS) operator → temp buyer (or self credit path)
 * 2) Register buyer, create USDC offer (or use existing)
 * 3) Quote → order → pay with token transfer tx
 *
 * Usage (from repo root, with .env loaded):
 *   npx tsx scripts/e2e-usdc.ts
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
const USDC_TOKEN_ID = process.env.USDC_TOKEN_ID || process.env.NEXT_PUBLIC_USDC_TOKEN_ID!;

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

async function main() {
  if (!OPERATOR_ID || !OPERATOR_KEY || !USDC_TOKEN_ID) {
    throw new Error("Need HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, USDC_TOKEN_ID");
  }

  console.log("BASE", BASE);
  console.log("USDC", USDC_TOKEN_ID);

  const opId = AccountId.fromString(OPERATOR_ID);
  const opKey = PrivateKey.fromStringDer(OPERATOR_KEY);
  const client = Client.forTestnet().setOperator(opId, opKey);
  const tokenId = TokenId.fromString(USDC_TOKEN_ID);

  // Create buyer account with HBAR for fees
  const buyerKey = PrivateKey.generateECDSA();
  const create = await new AccountCreateTransaction()
    .setECDSAKeyWithAlias(buyerKey.publicKey)
    .setInitialBalance(new Hbar(5))
    .execute(client);
  const createRx = await create.getReceipt(client);
  const buyerId = createRx.accountId!;
  console.log("buyer account", buyerId.toString());

  // Associate USDC
  const buyerClient = Client.forTestnet().setOperator(buyerId, buyerKey);
  await (
    await new TokenAssociateTransaction()
      .setAccountId(buyerId)
      .setTokenIds([tokenId])
      .freezeWith(buyerClient)
      .sign(buyerKey)
  )
    .execute(buyerClient)
    .then((t) => t.getReceipt(buyerClient));
  console.log("associated USDC");

  // Send 5 USDC (6 decimals) to buyer
  const amount = 5_000_000; // 5.000000
  await (
    await new TransferTransaction()
      .addTokenTransfer(tokenId, opId, -amount)
      .addTokenTransfer(tokenId, buyerId, amount)
      .execute(client)
  ).getReceipt(client);
  console.log("funded buyer with 5 USDC");

  // Register seller (operator wallet) + USDC offer
  const sellerReg = await api("/api/v1/agents/register", "POST", {
    name: "USDC Demo Seller",
    walletAccountId: OPERATOR_ID,
    capabilities: ["text.echo", "demo.usdc"],
  });
  const sellerKey =
    (sellerReg.json.apiKey as string) ||
    ((sellerReg.json.agent as { apiKey?: string })?.apiKey as string);
  console.log("seller status", sellerReg.status, "key", sellerKey?.slice(0, 8));

  const offerRes = await api(
    "/api/v1/offers",
    "POST",
    {
      capability: "demo.usdc",
      title: "USDC Echo Service",
      description: "Pay in USDC — get echo back",
      priceAmount: 0.05,
      priceAsset: "USDC",
      fulfillmentType: "inline",
      maxSeconds: 30,
    },
    sellerKey
  );
  const offer = (offerRes.json.offer || offerRes.json) as { id?: string };
  console.log("offer", offerRes.status, offer?.id);

  // Register buyer agent
  const buyerReg = await api("/api/v1/agents/register", "POST", {
    name: "USDC Demo Buyer",
    walletAccountId: buyerId.toString(),
    capabilities: ["buyer"],
  });
  const buyerApiKey =
    (buyerReg.json.apiKey as string) ||
    ((buyerReg.json.agent as { apiKey?: string })?.apiKey as string);

  // Quote
  const quoteRes = await api(
    "/api/v1/quotes",
    "POST",
    { offerId: offer.id, input: { text: "USDC hello" } },
    buyerApiKey
  );
  const quote = quoteRes.json.quote as {
    id: string;
    totalAmount: number;
    payTo: string;
  };
  console.log("quote", quoteRes.status, quote?.totalAmount, "payTo", quote?.payTo);

  // Order
  const orderRes = await api(
    "/api/v1/orders",
    "POST",
    { quoteId: quote.id },
    buyerApiKey
  );
  const orderId =
    (orderRes.json.orderId as string) ||
    ((orderRes.json as { order?: { id: string } }).order?.id as string);
  console.log("order", orderRes.status, orderId);

  // Pay with USDC transfer buyer → operator (payTo)
  const payTo = AccountId.fromString(quote.payTo);
  const payBase = Math.floor(quote.totalAmount * 1_000_000);
  const payTx = await new TransferTransaction()
    .addTokenTransfer(tokenId, buyerId, -payBase)
    .addTokenTransfer(tokenId, payTo, payBase)
    .freezeWith(buyerClient)
    .sign(buyerKey);
  const payExec = await payTx.execute(buyerClient);
  const payRx = await payExec.getReceipt(buyerClient);
  const txId = payExec.transactionId.toString();
  console.log("pay tx", txId, payRx.status.toString());

  // Wait mirror
  await new Promise((r) => setTimeout(r, 8000));

  const settle = await api(
    `/api/v1/orders/${orderId}/pay`,
    "POST",
    { transactionId: txId },
    buyerApiKey
  );
  console.log("settle", settle.status, JSON.stringify(settle.json).slice(0, 500));

  buyerClient.close();
  client.close();

  if (settle.status !== 200 || settle.json.ok !== true) {
    process.exitCode = 1;
    console.error("USDC E2E FAILED");
  } else {
    console.log("USDC E2E OK");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
