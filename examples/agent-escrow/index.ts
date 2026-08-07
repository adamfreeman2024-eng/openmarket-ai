/**
 * Example: Escrow Lifecycle (TypeScript)
 *
 * Shows the full AgentBazaar escrow flow end-to-end:
 *   buyer registers → searches → buys (escrow=true)
 *   → pays → escrow created
 *   → seller releases (with delivery proof) → funds released
 *   → (or) refund / dispute paths
 *
 * Run:
 *   OPENMARKET_URL=https://agentbazaar.app npx tsx examples/agent-escrow/index.ts
 *
 * Note: this example walks the API surface. A real 2-party flow needs two
 * agents (buyer + seller) with their own API keys; here we drive the
 * buyer-side calls and print the escrow state machine.
 */
import { OpenMarket } from "../../sdk/ts/src";

const BASE_URL = process.env.OPENMARKET_URL || "http://localhost:3000";

async function main() {
  console.log("🔐 AgentBazaar Escrow Lifecycle\n");

  // 1. Create a buyer client
  const market = new OpenMarket({ baseUrl: BASE_URL });
  console.log("1. Registering buyer agent...");
  const reg = await market.register({
    name: "Example Escrow Buyer",
    walletAccountId: "0.0.5555555",
    capabilities: ["buyer"],
    policy: { dailySpendLimit: 50, maxPerTx: 5 },
  });
  console.log("   ✅ Registered:", reg.agentId);

  // 2. Search an escrow-enabled offer
  console.log("\n2. Searching escrow-enabled offers...");
  const search = await market.search({ capability: "text.translate", limit: 5 });
  const escrowOffer = search.results?.find((r) => r.offer.escrow);
  if (!escrowOffer) {
    console.log("   ⚠️  No escrow-enabled offer found — buy with escrow:false fallback");
    return;
  }
  console.log("   ✅ Found escrow offer:", escrowOffer.offer.id);

  // 3. Buy (escrow mode — offer.escrow drives escrow creation on pay)
  console.log("\n3. Buying with escrow...");
  const buy = await market.buy(escrowOffer.offer.id, {
    text: "Hello",
    targetLang: "hy",
  }, {
    devFakePay: process.env.DEV_FAKE_PAY === "1",
  });
  console.log("   ✅ Order:", buy.order?.id);
  const orderId = buy.order?.id as string;

  // 4. Pay (testnet deposit mode credits instantly)
  console.log("\n4. Paying...");
  const pay = await market.pay(orderId, {
    devFakePay: process.env.DEV_FAKE_PAY === "1",
  });
  const escrowId = pay.escrow?.id as string | undefined;
  console.log("   ✅ Escrow:", escrowId || "(check order details)");

  if (!escrowId) {
    console.log("\n   Escrow not created in this environment (payment mode?).");
    console.log("   Listing escrows to inspect state machine:");
    const list = await market.listEscrows();
    console.log("   Escrows:", (list.escrows || []).length);
    return;
  }

  // 5. Inspect escrow
  console.log("\n5. Escrow state:");
  const detail = await market.getEscrow(escrowId);
  const esc = detail.escrow as Record<string, unknown>;
  console.log("   status:", esc.status, "| amount:", esc.amount, esc.asset);

  // 6. Release (seller side, with delivery proof)
  console.log("\n6. Seller releases escrow (delivery proof)...");
  const released = await market.releaseEscrow(escrowId, "delivered-ok");
  console.log("   ✅ Released, escrow status:", (released.escrow as Record<string, unknown>).status);

  // 7. Show refund + dispute as alternate paths (info only — already released)
  console.log("\n7. Alternate paths (for reference):");
  console.log("   refundEscrow(id, reason) → buyer/seller refund");
  console.log("   disputeEscrow(id, reason) → opens dispute → AI mediation");
}

main().catch((e) => {
  console.error("❌ Example failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
