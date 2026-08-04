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
  counterpartyWallet?: string,
  persistFn?: (updatedAgent: AgentRecord) => void // Optional callback to persist policy changes
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

  // CRITICAL FIX: Always reset daily counter on each check (prevents bypass via restart)
  const currentDay = utcDay();
  let needsUpdate = false;
  
  if (agent.policy.spentDay !== currentDay) {
    agent.policy.spentDay = currentDay;
    agent.policy.spentToday = 0;
    needsUpdate = true;
  }
  
  // Persist policy changes if callback provided
  if (needsUpdate && persistFn) {
    persistFn(agent);
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

  // ── TimeWindow (Spend Guardian layer 4) ──
  const windows = agent.policy.allowedHours || [];
  if (windows.length > 0) {
    const now = new Date();
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    const inWindow = windows.some(([start, end]) => {
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = end.split(":").map(Number);
      const s = (sh || 0) * 60 + (sm || 0);
      const e = (eh || 0) * 60 + (em || 0);
      // support overnight windows (end < start)
      return e >= s ? mins >= s && mins < e : mins >= s || mins < e;
    });
    results.push({
      allowed: inWindow,
      policy: "TimeWindow",
      reason: inWindow ? undefined : `Outside allowed trading hours (${windows.map((w) => w.join("-")).join(", ")} UTC)`,
    });
  } else {
    results.push({ allowed: true, policy: "TimeWindow" });
  }

  // ── Velocity (Spend Guardian layer 5) — max tx per rolling minute ──
  const velocity = agent.policy.velocityPerMinute || 0;
  const nowMs = Date.now();
  const spentAt = Array.isArray(agent.policy.spentAt) ? agent.policy.spentAt : [];
  // prune timestamps older than 60s
  const recent = spentAt.filter((t) => nowMs - t < 60_000);
  agent.policy.spentAt = recent;
  if (velocity > 0) {
    const allowed = recent.length < velocity;
    results.push({
      allowed,
      policy: "Velocity",
      reason: allowed ? undefined : `Exceeds ${velocity} tx/min velocity limit`,
    });
    if (allowed && persistFn) {
      // record this tx attempt so the velocity window is enforced on the NEXT buy
      agent.policy.spentAt = [...recent, nowMs];
      persistFn(agent);
    }
  } else {
    results.push({ allowed: true, policy: "Velocity" });
  }

  return results;
}

export function allAllowed(results: PolicyResult[]) {
  return results.every((r) => r.allowed);
}
