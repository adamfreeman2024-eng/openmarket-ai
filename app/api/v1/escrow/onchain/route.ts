import { json, options } from "@/lib/http";
import {
  escrowContractInfo,
  buildOnChainDepositPlan,
  isEscrowContractLive,
} from "@/lib/onchain-escrow";
import { getContractInfo } from "@/lib/onchain-escrow-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/escrow/onchain — live contract status + info */
export async function GET() {
  const staticInfo = escrowContractInfo();

  // Try to read live contract state
  let liveInfo = null;
  try {
    liveInfo = await getContractInfo();
  } catch {
    // ignore — contract may not be reachable
  }

  return json({
    ok: true,
    ...staticInfo,
    live: liveInfo ? true : staticInfo.live,
    contractState: liveInfo,
    hashScanUrl: liveInfo
      ? `https://hashscan.io/${liveInfo.address ? "testnet" : "testnet"}/contract/${staticInfo.address}`
      : null,
  });
}

/** POST plan deposit (does not send tx — returns calldata plan) */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!isEscrowContractLive()) {
    return json({
      ok: false,
      ...escrowContractInfo(),
      plan: buildOnChainDepositPlan({
        orderId: body.orderId || "ord_demo",
        sellerEvmAddress: body.sellerEvmAddress || "0x0000000000000000000000000000000000000001",
        amountWei: body.amountWei || "0",
      }),
    });
  }
  const plan = buildOnChainDepositPlan({
    orderId: String(body.orderId || ""),
    sellerEvmAddress: String(body.sellerEvmAddress || ""),
    amountWei: String(body.amountWei || "0"),
  });
  return json({ ok: plan.ok, plan });
}
