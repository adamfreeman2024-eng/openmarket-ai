/**
 * Quick unit test for the internal A2A ledger (half-finished work completion).
 * Run: npx tsx scripts/unit-ledger.ts
 */
import { db, newId, ensureSeedCatalog } from "../lib/store";
import {
  getBalance,
  creditAgent,
  debitAgent,
  creditSale,
} from "../lib/agent-ledger";
import type { AgentRecord } from "../lib/types";

ensureSeedCatalog();

function makeAgent(name: string, wallet: string): AgentRecord {
  const id = newId("agt");
  return {
    id,
    apiKey: `test-${id}`,
    name,
    walletAccountId: wallet,
    capabilities: ["test.cap"],
    policy: {
      dailySpendLimit: 1000,
      maxPerTx: 100,
      allowedCounterparties: [],
      spentToday: 0,
      spentDay: "2026-01-01",
    },
    stats: { sales: 0, purchases: 0, success: 0, fail: 0, totalLatencyMs: 0 },
    verificationStatus: "bronze",
    createdAt: new Date().toISOString(),
  };
}

const seller = makeAgent("Ledger Test Seller", "0.0.1001");
const buyer = makeAgent("Ledger Test Buyer", "0.0.1002");
db.putAgent(seller);
db.putAgent(buyer);

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

console.log("== Ledger unit test ==");

// 1. Initial balance is 0
check("initial seller balance 0", getBalance(seller) === 0, `got ${getBalance(seller)}`);
check("initial buyer balance 0", getBalance(buyer) === 0, `got ${getBalance(buyer)}`);

// 2. creditSale credits the seller
const afterSale = creditSale(seller.id, 12.5, "ord-test-1");
check("seller credited 12.5", afterSale !== null && getBalance(afterSale) === 12.5, `got ${afterSale ? getBalance(afterSale) : "null"}`);

// 3. creditAgent accumulates
const afterCredit = creditAgent(seller.id, 2.5, "bonus");
check("seller accumulates to 15", afterCredit !== null && getBalance(afterCredit) === 15, `got ${afterCredit ? getBalance(afterCredit) : "null"}`);

// 4. debitAgent works with sufficient balance
creditAgent(buyer.id, 10, "seed");
const debitOk = debitAgent(buyer.id, 5, "hire:test");
check("buyer debit ok", debitOk.ok === true, `err=${!debitOk.ok ? debitOk.error : ""}`);
if (debitOk.ok) check("buyer balance now 5", getBalance(debitOk.agent) === 5, `got ${getBalance(debitOk.agent)}`);

// 5. debitAgent rejects insufficient balance
const sellerBal = getBalance(seller);
const debitFail = debitAgent(seller.id, sellerBal + 100, "overspend");
check("seller overspend rejected", debitFail.ok === false, "should have failed");
if (!debitFail.ok) check("error mentions INSUFFICIENT", debitFail.error.includes("INSUFFICIENT_BALANCE"), debitFail.error);

// 6. debit does not touch balance on failure
check("seller balance unchanged", getBalance(seller) === sellerBal, `got ${getBalance(seller)}`);

// 7. invalid amounts
check("zero credit no-op", creditAgent(seller.id, 0, "noop") !== null);
check("negative debit rejected", debitAgent(seller.id, -1, "bad").ok === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
