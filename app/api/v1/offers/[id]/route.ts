import { NextRequest } from "next/server";
import { z } from "zod";
import { db, audit, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import { cache } from "@/lib/cache";
import { getBalance, debitAgent } from "@/lib/agent-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const BOOST_DAYS = 7;
const BOOST_PRICE = 5; // internal balance units per 7 days

/** GET /api/v1/offers/:id */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const { id } = await ctx.params;
  const o = db.getOffer(id);
  if (!o) return json({ ok: false, error: "Not found" }, 404);
  return json({ ok: true, offer: o });
}

/** POST /api/v1/offers/:id/boost — paid visibility boost (7 days, from internal balance) */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;
  const { id } = await ctx.params;

  const rl = await redisRateLimit(`offer-action:${clientKey(req)}`, 30, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const o = db.getOffer(id);
  if (!o) return json({ ok: false, error: "Not found" }, 404);
  if (o.agentId !== agent.id) {
    return json({ ok: false, error: "Not your offer" }, 403);
  }

  const balance = getBalance(agent);
  if (balance < BOOST_PRICE) {
    return json({ ok: false, error: "INSUFFICIENT_BALANCE", balance, boostPrice: BOOST_PRICE }, 402);
  }

  const debited = debitAgent(agent.id, BOOST_PRICE, `boost:${o.id}`);
  if (!debited.ok) return json({ ok: false, error: debited.error }, 400);

  const from = o.boostedUntil && new Date(o.boostedUntil).getTime() > Date.now()
    ? new Date(o.boostedUntil)
    : new Date();
  const boostedUntil = new Date(from.getTime() + BOOST_DAYS * 24 * 3600 * 1000).toISOString();

  db.putOffer({ ...o, boostedUntil });
  audit("offer.boost", { offerId: o.id, agentId: agent.id, amount: BOOST_PRICE, boostedUntil });
  cache.del("offers:list");

  return json({
    ok: true,
    boostedUntil,
    balance: getBalance(agent),
  });
}

/** DELETE /api/v1/offers/:id — seller deactivates own offer */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;
  const { id } = await ctx.params;
  const o = db.getOffer(id);
  if (!o) return json({ ok: false, error: "Not found" }, 404);
  if (o.agentId !== agent.id) {
    return json({ ok: false, error: "Not your offer" }, 403);
  }
  o.active = false;
  db.putOffer(o);
  audit("offer.deactivate", { offerId: id, agentId: agent.id });
  await cache.del("offers:list");
  return json({ ok: true, offer: o });
}
