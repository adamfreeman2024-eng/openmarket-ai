/**
 * Unit tests for settlement helpers (no network).
 */
import { normalizeTxId } from "../lib/settlement";
import { toBaseUnits, fromBaseUnits } from "../lib/assets";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  normalizeTxId("0.0.123@1700000000.000000001") ===
    "0.0.123-1700000000-000000001",
  "normalize @"
);
assert(normalizeTxId("0.0.123-1-2") === "0.0.123-1-2", "normalize dash");

assert(toBaseUnits("HBAR", 1) === 100_000_000, "hbar base");
assert(toBaseUnits("USDC", 1.5) === 1_500_000, "usdc base 6dp");
assert(fromBaseUnits("HBAR", 100_000_000) === 1, "hbar from");

console.log("SETTLEMENT_UNIT_OK");
