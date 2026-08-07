/**
 * E2E Phase 6 — the complete agent-first growth chain, live.
 *
 * Verifies, end-to-end on the live server:
 *  1. Managed hosting opt-in is ACTIVE (POST /api/v1/managed/agents is not 403)
 *  2. Auto-Hire (Task 6.1): one call → best-agent pick → internal-balance pay → fulfill
 *  3. SLA guarantee (Task 6.2): quote exposes escrowDeadline; buy 402 exposes
 *     guarantee{escrow,deadline,message}; non-escrow never claims one
 *  4. Auto-payout (Task 6.3): seller opts in via PATCH /agents/me →
 *     admin run (dryRun preview, then real) → payout created + ledger debited
 *
 * Run: set -a && . ./.env && set +a && OPENMARKET_URL=http://127.0.0.1:3010 npx tsx scripts/e2e-phase6.ts
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
const ADMIN_KEY = process.env.ADMIN_API_KEY!;

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
let failures = 0;
function check(cond: boolean, label: string, detail = "") {
  if (cond) console.log(`   ✅ ${label}${detail ? " — " + detail : ""}`);
  else { console.log(`   ❌ FAIL: ${label}${detail ? " — " + detail : ""}`); failures++; }
}

async function main() {
  console.log("BASE:", BASE, "| USDC:", USDC_TOKEN_ID);
  if (!OPERATOR_ID || !OPERATOR_KEY || !USDC_TOKEN_ID || !ADMIN_KEY) {
    console.error("Missing env: HEDERA_OPERATOR_ID/KEY, USDC_TOKEN_ID, ADMIN_API_KEY");
    process.exit(1);
  }
  const opId = AccountId.fromString(OPERATOR_ID);
  const opKey = PrivateKey.fromStringDer(OPERATOR_KEY);
  const client = Client.forTestnet().setOperator(opId, opKey);
  const tokenId = TokenId.fromString(USDC_TOKEN_ID);

  // ── 0. Managed hosting opt-in gate ──────────────────────────────────
  say("0. Managed hosting opt-in (Task 4.1 blocker)");
  const mgGate = await api("/api/v1/managed/agents", "POST", { name: "gate-probe", capability: "x" }, "no-such-key");
  const mgErr = String((mgGate.json as { error?: string }).error || "");
  const gateActive = mgGate.status !== 403 && mgErr.includes("Managed hosting is disabled") === false;
  check(gateActive, `managed hosting enabled (got ${mgGate.status} ${mgErr || "auth-required"}, not 403-disabled)`);

  // ── 1. Fresh seller + offers ────────────────────────────────────────
  say("1. Fresh seller + 2 offers (non-escrow echo, escrow translate)");
  const sellerReg = await api("/api/v1/agents/register", "POST", {
    name: "P6 E2E Seller", walletAccountId: OPERATOR_ID,
    capabilities: ["demo.echo", "text.translate"],
    policy: { dailySpendLimit: 500, maxPerTx: 50 },
  });
  const sellerKey = sellerReg.json.apiKey as string;
  const sellerId = sellerReg.json.agentId as string;
  check(Boolean(sellerKey), "seller registered", sellerId);

  const echoOff = await api("/api/v1/offers", "POST", {
    capability: "demo.echo", title: "P6 Echo (non-escrow)", priceAmount: 0.5,
    priceAsset: "USDC", fulfillmentType: "inline", maxSeconds: 10, escrow: false,
  }, sellerKey);
  const echoOfferId = ((echoOff.json.offer || echoOff.json) as { id?: string }).id as string;
  const trOff = await api("/api/v1/offers", "POST", {
    capability: "text.translate", title: "P6 Translate (escrow)", priceAmount: 2.0,
    priceAsset: "USDC", fulfillmentType: "llm", maxSeconds: 60, escrow: true,
  }, sellerKey);
  const trOfferId = ((trOff.json.offer || trOff.json) as { id?: string }).id as string;
  check(Boolean(echoOfferId) && Boolean(trOfferId), "offers created", `${echoOfferId} / ${trOfferId}`);

  // ── 2. Fresh buyer wallet + USDC + agent ────────────────────────────
  say("2. Fresh buyer wallet + 12 USDC + agent");
  const buyerWalletKey = PrivateKey.generateECDSA();
  const createRx = await (await new AccountCreateTransaction()
    .setECDSAKeyWithAlias(buyerWalletKey.publicKey)
    .setInitialBalance(new Hbar(5)).execute(client)).getReceipt(client);
  const buyerId = createRx.accountId!;
  const buyerClient = Client.forTestnet().setOperator(buyerId, buyerWalletKey);
  await (await new TokenAssociateTransaction()
    .setAccountId(buyerId).setTokenIds([tokenId]).freezeWith(buyerClient).sign(buyerWalletKey))
    .execute(buyerClient).then((t) => t.getReceipt(buyerClient));
  const fund = 12_000_000;
  await (await new TransferTransaction()
    .addTokenTransfer(tokenId, opId, -fund).addTokenTransfer(tokenId, buyerId, fund)
    .execute(client)).getReceipt(client);

  const buyerReg = await api("/api/v1/agents/register", "POST", {
    name: "P6 E2E Buyer", walletAccountId: buyerId.toString(),
    capabilities: ["buyer"], policy: { dailySpendLimit: 100, maxPerTx: 20 },
  });
  const buyerKey = buyerReg.json.apiKey as string;
  check(Boolean(buyerKey), "buyer agent", buyerReg.json.agentId as string);

  // Deposit 5 USDC → internal balance (mirror-verified)
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
  const depMode = (dep.json as { mode?: string }).mode;
  check(dep.status === 201, "deposit verified", `mode=${depMode} balance=${(dep.json as { balance?: number }).balance}`);

  // ── 3. SLA guarantee (Task 6.2) ─────────────────────────────────────
  say("3. SLA guarantee surfaced before paying");
  const q = await api("/api/v1/quotes", "POST", { offerId: trOfferId, input: { text: "hello", targetLang: "hy" } }, buyerKey);
  const qDeadline = (q.json as { escrowDeadline?: string }).escrowDeadline;
  check(Boolean(qDeadline), "quote exposes escrowDeadline", qDeadline as string);

  const buy402 = await api("/api/v1/buy", "POST", { offerId: trOfferId, input: { text: "hello", targetLang: "hy" } }, buyerKey);
  const g = (buy402.json as { guarantee?: { escrow?: boolean; deadline?: string; message?: string } }).guarantee;
  check(buy402.status === 402 && g?.escrow === true && Boolean(g?.deadline), "buy 402 exposes guarantee{escrow,deadline}", `status=${buy402.status}`);
  check(Boolean(g?.message && g!.message!.includes("automatically refunded")), "guarantee message states auto-refund");

  const qPlain = await api("/api/v1/quotes", "POST", { offerId: echoOfferId, input: { text: "x" } }, buyerKey);
  check((qPlain.json as { escrowDeadline?: string }).escrowDeadline === undefined, "non-escrow quote has NO escrowDeadline");

  // ── 4. Auto-Hire (Task 6.1) ────────────────────────────────────────
  say("4. Auto-Hire — one call, best agent, internal-balance pay");
  const t0 = Date.now();
  const ah = await api("/api/v1/auto-hire", "POST", {
    capability: "demo.echo", input: { text: "phase6 auto-hire" },
  }, buyerKey);
  const ahMs = Date.now() - t0;
  const ahJson = ah.json as { ok?: boolean; orderId?: string; seller?: { id: string }; balance?: number };
  check(ah.status === 200 && ahJson.ok === true, "auto-hire ok", `order=${ahJson.orderId} in ${ahMs}ms (best-match seller may differ)`);
  if (ahJson.orderId) {
    const oInfo = await api(`/api/v1/orders/${ahJson.orderId}`, "GET", undefined, buyerKey);
    const oJson = oInfo.json as { order?: { status?: string; transactionId?: string } };
    check(oJson.order?.status === "completed", "auto-hire order completed");
    check(String(oJson.order?.transactionId || "").startsWith("internal:"), "paid from internal balance", oJson.order?.transactionId as string);
  }
  check(ahJson.balance !== undefined && ahJson.balance < 5, "buyer balance reduced", `balance=${ahJson.balance}`);

  // Direct buy from OUR seller's echo offer so the seller definitely earns
  // (auto-hire picks the best-match seller, which may be a different one).
  const directBuy = await api("/api/v1/buy", "POST", {
    offerId: echoOfferId, input: { text: "direct to P6 seller" },
  }, buyerKey);
  check(directBuy.status === 200, "direct buy from P6 seller", `status=${(directBuy.json as { order?: { status?: string } }).order?.status}`);

  // ── 5. Auto-payout (Task 6.3) ───────────────────────────────────────
  say("5. Auto-payout — opt-in → dryRun → real run");
  // Seller earned ~0.5 from the echo auto-hire sale; opt in for payouts.
  const optIn = await api("/api/v1/agents/me", "PATCH", { payoutMethod: "usdc", payoutAccount: OPERATOR_ID }, sellerKey);
  check(optIn.status === 200, "seller opted in via PATCH /agents/me");
  const meBefore = await api("/api/v1/me", "GET", undefined, sellerKey);
  const sellerBalBefore = (meBefore.json as { agent?: { internalBalance?: number } }).agent?.internalBalance || 0;
  console.log("   seller internalBalance before run:", sellerBalBefore);

  // dryRun with a tiny threshold so the seller is eligible — must preview, not pay.
  const dry = await api("/api/v1/admin/payouts/run", "POST", { threshold: 0.01, dryRun: true }, ADMIN_KEY);
  const dryJson = dry.json as { created?: number; wouldPay?: Array<{ agentId: string }> };
  check(dry.status === 200 && dryJson.created === 1 && dryJson.wouldPay?.some((p) => p.agentId === sellerId), "dryRun previews seller payout");

  const real = await api("/api/v1/admin/payouts/run", "POST", { threshold: 0.01 }, ADMIN_KEY);
  const realJson = real.json as { created?: number; payouts?: Array<{ agentId?: string; amount?: number; status?: string; id?: string }> };
  const myPayout = (realJson.payouts || []).find((p) => p.agentId === sellerId);
  check(real.status === 200 && myPayout?.status === "requested", "real run created payout", `id=${myPayout?.id} amount=${myPayout?.amount}`);

  const meAfter = await api("/api/v1/me", "GET", undefined, sellerKey);
  const sellerBalAfter = (meAfter.json as { agent?: { internalBalance?: number } }).agent?.internalBalance || 0;
  check(sellerBalAfter < sellerBalBefore, "ledger debited", `${sellerBalBefore} → ${sellerBalAfter}`);

  const repeat = await api("/api/v1/admin/payouts/run", "POST", { threshold: 0.01 }, ADMIN_KEY);
  const repeatJson = repeat.json as { created?: number; skippedOpenPayout?: number };
  check(repeat.status === 200 && repeatJson.created === 0, "idempotent — repeat run creates nothing");

  // ── 6. Managed hosting live spawn (Task 4.1) ────────────────────────
  say("6. Managed hosting — spawn demo agent");
  const mg = await api("/api/v1/managed/agents", "POST", {
    name: "P6 Managed Demo",
    capability: "demo.echo",
    script: "scripts/managed/demo-agent.js",
    env: { AGENT_NAME: "P6 Managed Demo", AGENT_PORT: "4021" },
  }, sellerKey);
  const mgJson = mg.json as { ok?: boolean; managed?: { id?: string; status?: string }; error?: string };
  check(mg.status === 201 && mgJson.ok === true, "managed agent spawned", `id=${mgJson.managed?.id} status=${mgJson.managed?.status}`);
  if (mgJson.managed?.id) {
    const st = await api(`/api/v1/managed/agents/${mgJson.managed.id}`, "GET", undefined, sellerKey);
    check(st.status === 200, "managed agent status readable");
  }

  buyerClient.close();
  client.close();
  console.log(`\n${failures === 0 ? "✅ ALL PHASE 6 E2E CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
