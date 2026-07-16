import { NextRequest } from "next/server";
import { AgentRegisterSchema } from "@/lib/types";
import { db, newId, utcDay, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options } from "@/lib/http";
import { nanoid } from "nanoid";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** POST /api/v1/agents/register — agent-native signup (1 call) */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`reg:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) return json({ ok: false, error: "Rate limit" }, 429);

  ensureSeedCatalog();
  const body = await req.json().catch(() => null);
  const parsed = AgentRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { ok: false, error: "Invalid body", details: parsed.error.flatten() },
      400
    );
  }
  const d = parsed.data;
  const key = "omk_" + nanoid(24);
  const agent = {
    id: newId("agt"),
    apiKey: key,
    name: d.name,
    walletAccountId: d.walletAccountId,
    webhookUrl: d.webhookUrl,
    capabilities: d.capabilities,
    homepage: d.homepage,
    policy: {
      dailySpendLimit: d.policy?.dailySpendLimit ?? 50,
      maxPerTx: d.policy?.maxPerTx ?? 5,
      allowedCounterparties: d.policy?.allowedCounterparties ?? [],
      spentToday: 0,
      spentDay: utcDay(),
    },
    stats: {
      sales: 0,
      purchases: 0,
      success: 0,
      fail: 0,
      totalLatencyMs: 0,
    },
    createdAt: new Date().toISOString(),
  };
  db.putAgent(agent);
  audit("agent.register", { agentId: agent.id, name: agent.name });
  return json({
    ok: true,
    agentId: agent.id,
    apiKey: key,
    cardUrl: `/api/v1/agents/${agent.id}`,
    note: "Store apiKey securely — required as X-Api-Key for seller/buyer calls",
  });
}
