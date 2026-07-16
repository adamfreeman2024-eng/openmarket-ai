import { json, options } from "@/lib/http";
import {
  escrowContractInfo,
  buildOnChainDepositPlan,
  isEscrowContractLive,
} from "@/lib/onchain-escrow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return options();
}

/** GET /api/v1/escrow/onchain — contract status + ABI for agents */
export async function GET() {
  return json({
    ok: true,
    ...escrowContractInfo(),
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
