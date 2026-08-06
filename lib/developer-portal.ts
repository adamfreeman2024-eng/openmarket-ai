/**
 * Developer Portal — leaderboard (Phase 2 DevX, docs/DEVELOPER_PORTAL_AND_SHOWCASE.md).
 *
 * MVP note: the data model has no `developers` table / owner_id yet (the portal
 * doc flags that as future work). Until that lands, a "developer" is identified
 * by githubHandle when present (Silver/Gold verified devs), otherwise by agent id
 * (each agent is its own developer entry). Revenue and hires are derived from
 * completed orders — no schema change required.
 */

import type { AgentRecord, OrderRecord } from "./types";

export type DeveloperRow = {
  /** githubHandle when present, otherwise agent id */
  key: string;
  name: string;
  agentIds: string[];
  verificationStatus: string;
  githubHandle?: string;
  homepage?: string;
  /** gross revenue from completed orders (sum of totalAmount) */
  revenue: number;
  /** number of completed orders */
  hires: number;
  /** success / (success + fail) from agent stats; null when no attempts */
  successRate: number | null;
  createdAt: string;
};

export type Leaderboard = {
  byRevenue: DeveloperRow[];
  byHires: DeveloperRow[];
};

export function computeLeaderboard(
  agents: AgentRecord[],
  orders: OrderRecord[],
  limit = 10
): Leaderboard {
  const completed = orders.filter((o) => o.status === "completed");

  // Group agents under a developer key (githubHandle or agent id).
  const byKey = new Map<string, AgentRecord[]>();
  for (const a of agents) {
    const key = a.githubHandle || a.id;
    const arr = byKey.get(key) ?? [];
    arr.push(a);
    byKey.set(key, arr);
  }
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const revenue = new Map<string, number>();
  const hires = new Map<string, number>();
  for (const o of completed) {
    const agent = agentById.get(o.sellerAgentId);
    if (!agent) continue;
    const key = agent.githubHandle || agent.id;
    revenue.set(key, (revenue.get(key) ?? 0) + (o.totalAmount || 0));
    hires.set(key, (hires.get(key) ?? 0) + 1);
  }

  const rows: DeveloperRow[] = [];
  for (const [key, list] of byKey) {
    const first = list[0];
    let success = 0;
    let fail = 0;
    for (const a of list) {
      success += a.stats?.success ?? 0;
      fail += a.stats?.fail ?? 0;
    }
    const total = success + fail;
    rows.push({
      key,
      name: first.name,
      agentIds: list.map((a) => a.id),
      verificationStatus: first.verificationStatus ?? "bronze",
      githubHandle: first.githubHandle,
      homepage: first.homepage,
      revenue: revenue.get(key) ?? 0,
      hires: hires.get(key) ?? 0,
      successRate: total === 0 ? null : success / total,
      createdAt: first.createdAt,
    });
  }

  const byRevenue = [...rows].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
  const byHires = [...rows].sort((a, b) => b.hires - a.hires).slice(0, limit);
  return { byRevenue, byHires };
}
