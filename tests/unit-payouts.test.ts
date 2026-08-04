/**
 * Payout store unit tests — add + list + persistence shape.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let tmpDir: string;
let payouts: typeof import("../lib/payouts");

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "payouts-test-"));
  process.env.OM_DATA_DIR = tmpDir;
  payouts = await import("../lib/payouts");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("payouts", () => {
  it("adds a payout and lists it per agent", () => {
    const p = payouts.addPayout({
      agentId: "agt_seller1",
      amount: 5,
      method: "hbar",
      account: "0.0.1234",
    });
    expect(p.id).toMatch(/^pout_/);
    expect(p.status).toBe("requested");
    expect(p.amount).toBe(5);

    const mine = payouts.listPayoutsByAgent("agt_seller1");
    expect(mine.length).toBe(1);
    expect(mine[0].id).toBe(p.id);

    const others = payouts.listPayoutsByAgent("agt_seller2");
    expect(others.length).toBe(0);
  });

  it("persists across loads (file exists)", () => {
    const all = payouts.listAllPayouts();
    expect(all.length).toBeGreaterThan(0);
    const file = path.join(tmpDir, "payouts.json");
    expect(fs.existsSync(file)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(onDisk.length).toBe(all.length);
  });
});
