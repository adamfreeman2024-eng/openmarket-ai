import type { AgentRecord } from "./types";
import { utcDay } from "./store";

export type PolicyResult = {
  allowed: boolean;
  policy: string;
  reason?: string;
};

/** Lightweight Spend Guardian-style gates for buyer agents */
export function evaluateBuyerPolicy(
  agent: AgentRecord | undefined,
  amount: number,
  counterpartyWallet?: string
): PolicyResult[] {
  const results: PolicyResult[] = [];
  if (!agent) {
    // Anonymous buyer — allow with soft defaults
    results.push({
      allowed: amount <= 5,
      policy: "AnonymousCap",
      reason: amount <= 5 ? undefined : "Anonymous buyers limited to 5 units/tx",
    });
    return results;
  }

  // reset daily counter
  if (agent.policy.spentDay !== utcDay()) {
    agent.policy.spentDay = utcDay();
    agent.policy.spentToday = 0;
  }

  const maxPerTx = agent.policy.maxPerTx;
  results.push({
    allowed: amount <= maxPerTx,
    policy: "MaxPerTx",
    reason:
      amount <= maxPerTx
        ? undefined
        : `Amount ${amount} exceeds maxPerTx ${maxPerTx}`,
  });

  const daily = agent.policy.dailySpendLimit;
  results.push({
    allowed: agent.policy.spentToday + amount <= daily,
    policy: "DailySpendLimit",
    reason:
      agent.policy.spentToday + amount <= daily
        ? undefined
        : `Daily spend would exceed ${daily}`,
  });

  const allow = agent.policy.allowedCounterparties;
  if (allow.length > 0 && counterpartyWallet) {
    results.push({
      allowed: allow.includes(counterpartyWallet),
      policy: "Allowlist",
      reason: allow.includes(counterpartyWallet)
        ? undefined
        : `Counterparty ${counterpartyWallet} not in allowlist`,
    });
  } else {
    results.push({ allowed: true, policy: "Allowlist" });
  }

  return results;
}

export function allAllowed(results: PolicyResult[]) {
  return results.every((r) => r.allowed);
}
