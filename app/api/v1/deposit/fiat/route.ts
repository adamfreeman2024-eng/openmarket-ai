/**
 * POST /api/v1/deposit/fiat — fiat on-ramp (Task 6.4 scaffold).
 * Creates a provider payment intent (Stripe / Unlimit / IDram) that, once
 * completed, credits the buyer's internal balance. Until the operator sets
 * provider credentials (FIAT_PROVIDER + provider keys) this returns
 * 501 NOT_CONFIGURED with instructions.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";
import { redisRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";
import {
  createFiatPayment,
  getFiatConfig,
  isFiatConfigured,
} from "@/lib/payments/fiat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

const Body = z.object({
  amount: z.number().positive().max(1_000_000),
  currency: z.string().min(3).max(3).optional(),
  memo: z.string().max(256).optional(),
});

export async function POST(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const rl = await redisRateLimit(`deposit-fiat:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.remaining);

  const cfg = getFiatConfig();
  if (!isFiatConfigured()) {
    return json(
      {
        ok: false,
        code: "NOT_CONFIGURED",
        error:
          "Fiat on-ramp is not configured yet. Set FIAT_PROVIDER (stripe|unlimit|idram) plus the provider's credentials, then restart. See docs/FIAT-ONRAMP.md.",
        providers: cfg.creds,
      },
      501
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "Invalid body", details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;

  try {
    const intent = await createFiatPayment({
      amount: d.amount,
      currency: d.currency,
      agentId: agent.id,
      memo: d.memo,
    });
    return json(
      {
        ok: true,
        intent,
        note: "Scaffold intent — payment completion will credit internalBalance once the provider webhook is wired (docs/FIAT-ONRAMP.md).",
      },
      201
    );
  } catch (e) {
    const code = (e as Error & { code?: string }).code;
    if (code === "NOT_CONFIGURED") {
      return json({ ok: false, code, error: "Fiat on-ramp not configured" }, 501);
    }
    return json({ ok: false, error: (e as Error).message || "FIAT_ERROR" }, 400);
  }
}

/** GET /api/v1/deposit/fiat — config status (no secrets). */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;
  const cfg = getFiatConfig();
  return json({
    ok: true,
    configured: cfg.configured,
    provider: cfg.configuredProvider ?? null,
    currency: cfg.currency,
    // Which provider creds are present (booleans only — never secrets).
    creds: {
      stripe: cfg.creds.stripe,
      unlimit: cfg.creds.unlimit,
      idram: cfg.creds.idram,
    },
    docs: "/docs/FIAT-ONRAMP.md",
  });
}
