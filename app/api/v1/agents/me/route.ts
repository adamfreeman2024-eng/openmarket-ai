import { NextRequest } from "next/server";
import { z } from "zod";
import { db, ensureSeedCatalog } from "@/lib/store";
import { json, options, requireAgent, isResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** PATCH body — update notification/webhook contact fields */
const PatchSchema = z
  .object({
    webhookUrl: z.string().url().optional(),
    telegramChatId: z.string().min(1).max(64).nullable().optional(),
    email: z.string().email().nullable().optional(),
  })
  .refine((v) => v.webhookUrl !== undefined || v.telegramChatId !== undefined || v.email !== undefined, {
    message: "Provide at least one field: webhookUrl, telegramChatId, email",
  });

/** PATCH /api/v1/agents/me — update contact/notification settings */
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
