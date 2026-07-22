import { json, options } from "@/lib/http";
import {
  marketCard,
  NETWORK,
  ALLOW_DEV_FAKE_SETTLEMENT,
  USDC_TOKEN_ID,
  ESCROW_CONTRACT_ADDRESS,
} from "@/lib/config";
import { ensureSeedCatalog, db } from "@/lib/store";
import { llmMeta } from "@/lib/llm";
import { productionChecks } from "@/lib/production-check";
import { ensureDemoWebhookOffer } from "@/lib/demo-webhook-offer";
import * as path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/health — ops + agent readiness probe */
export async function GET() {
  ensureSeedCatalog();
  ensureDemoWebhookOffer();
  const card = marketCard();
  const llm = llmMeta();
  const prod = productionChecks();
  return json({
    ok: true,
    status: "healthy",
    version: card.version,
    foundation: "1.0",
    network: NETWORK,
    time: new Date().toISOString(),
    agents: db.listAgents().length,
    offers: db.listOffers().length,
    orders: db.listOrders().length,
    escrows: db.listEscrows().length,
    flags: {
      devFakeSettlement: ALLOW_DEV_FAKE_SETTLEMENT,
      usdcTokenId: USDC_TOKEN_ID || null,
      usdcLive: Boolean(USDC_TOKEN_ID),
      escrowContractLive: Boolean(ESCROW_CONTRACT_ADDRESS),
      llmConfigured: llm.configured,
      llmFulfillEnabled: llm.enabled,
      llmModel: llm.model,
    },
    production: {
      mode: prod.productionMode,
      ready: prod.ready,
      failedChecks: prod.checks.filter((c) => !c.ok).map((c) => c.id),
    },
    dataDir: process.env.OM_DATA_DIR || path.resolve(process.cwd(), "data"),
    storeBackend: db.backend(),
  });
}
