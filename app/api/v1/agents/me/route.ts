import { NextRequest } from "next/server";
import { z } from "zod";
import { db, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** PATCH body — update notification/webhook contact fields + Spend Guardian policy */
const PatchSchema = z
  .object({
    webhookUrl: z.string().url().optional(),
    telegramChatId: z.string().min(1).max(64).nullable().optional(),
    email: z.string().email().nullable().optional(),
    policy: z
      .object({
        dailySpendLimit: z.number().positive().optional(),
        maxPerTx: z.number().positive().optional(),
        allowedCounterparties: z.array(z.string()).optional(),
        allowedHours: z.array(z.tuple([z.string(), z.string()])).optional(),
        velocityPerMinute: z.number().nonnegative().optional(),
      })
      .optional(),
  })
  .refine(
    (v) =>
      v.webhookUrl !== undefined ||
      v.telegramChatId !== undefined ||
      v.email !== undefined ||
      v.policy !== undefined,
    {
      message: "Provide at least one field: webhookUrl, telegramChatId, email, policy",
    }
  );

/** PATCH /api/v1/agents/me — update contact/notification settings + policy */
export async function PATCH(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "Invalid body", details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  if (d.webhookUrl !== undefined) agent.webhookUrl = d.webhookUrl;
  if (d.telegramChatId !== undefined) agent.telegramChatId = d.telegramChatId ?? undefined;
  if (d.email !== undefined) agent.email = d.email ?? undefined;
  if (d.policy) {
    if (d.policy.dailySpendLimit !== undefined) agent.policy.dailySpendLimit = d.policy.dailySpendLimit;
    if (d.policy.maxPerTx !== undefined) agent.policy.maxPerTx = d.policy.maxPerTx;
    if (d.policy.allowedCounterparties !== undefined) agent.policy.allowedCounterparties = d.policy.allowedCounterparties;
    if (d.policy.allowedHours !== undefined) agent.policy.allowedHours = d.policy.allowedHours;
    if (d.policy.velocityPerMinute !== undefined) agent.policy.velocityPerMinute = d.policy.velocityPerMinute;
  }
  db.putAgent(agent);

  return json({
    ok: true,
    agent: {
      id: agent.id,
      webhookUrl: agent.webhookUrl || null,
      telegramChatId: agent.telegramChatId ? "configured" : null,
      email: agent.email ? "configured" : null,
    },
  });
}

/** GET /api/v1/agents/me — current agent from X-Api-Key */
export async function GET(req: NextRequest) {
  ensureSeedCatalog();
  const agent = requireAgent(req);
  if (isResponse(agent)) return agent;
  return json({
    ok: true,
    agent: {
      id: agent.id,
      name: agent.name,
      walletAccountId: agent.walletAccountId,
      capabilities: agent.capabilities,
      homepage: agent.homepage,
      webhookUrl: agent.webhookUrl,
      policy: {
        dailySpendLimit: agent.policy.dailySpendLimit,
        maxPerTx: agent.policy.maxPerTx,
        allowedCounterparties: agent.policy.allowedCounterparties,
        allowedHours: agent.policy.allowedHours || [],
        velocityPerMinute: agent.policy.velocityPerMinute || 0,
        spentToday: agent.policy.spentToday,
        spentDay: agent.policy.spentDay,
      },
      stats: agent.stats,
      verificationStatus: agent.verificationStatus || "bronze",
      githubHandle: agent.githubHandle || null,
      githubVerificationPending: Boolean(agent.githubVerificationToken),
      telegramChatId: agent.telegramChatId ? "configured" : null,
      email: agent.email ? "configured" : null,
      createdAt: agent.createdAt,
    },
  });
}
