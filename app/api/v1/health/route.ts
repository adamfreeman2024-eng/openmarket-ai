import { json, options } from "@/lib/http";
import {
  marketCard,
  NETWORK,
  ALLOW_DEV_FAKE_SETTLEMENT,
  USDC_TOKEN_ID,
} from "@/lib/config";
import { ensureSeedCatalog, db } from "@/lib/store";
import * as path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/health — ops + agent readiness probe */
export async function GET() {
  ensureSeedCatalog();
  const card = marketCard();
  return json({
    ok: true,
    status: "healthy",
    version: card.version,
    network: NETWORK,
    time: new Date().toISOString(),
    agents: db.listAgents().length,
    offers: db.listOffers().length,
    orders: db.listOrders().length,
    escrows: db.listEscrows().length,
    flags: {
      devFakeSettlement: ALLOW_DEV_FAKE_SETTLEMENT,
      usdcLive: Boolean(USDC_TOKEN_ID),
    },
    dataDir: process.env.OM_DATA_DIR || path.resolve(process.cwd(), "data"),
    storeBackend: db.backend(),
  });
}
