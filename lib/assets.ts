/**
 * Asset amount helpers (HBAR / USDC).
 */
import { USDC_TOKEN_ID, USDC_DECIMALS } from "./config";

export function assertAssetLive(asset: "HBAR" | "USDC"): {
  ok: boolean;
  error?: string;
} {
  if (asset === "USDC" && !USDC_TOKEN_ID) {
    return {
      ok: false,
      error:
        "USDC not live — set USDC_TOKEN_ID / NEXT_PUBLIC_USDC_TOKEN_ID (HTS token)",
    };
  }
  return { ok: true };
}

/** Human amount → base units for HTS (USDC) or tinybars for HBAR */
export function toBaseUnits(asset: "HBAR" | "USDC", human: number): number {
  if (asset === "USDC") {
    return Math.floor(human * Math.pow(10, USDC_DECIMALS));
  }
  // HBAR tinybars
  return Math.floor(human * 1e8);
}

export function fromBaseUnits(asset: "HBAR" | "USDC", base: number): number {
  if (asset === "USDC") return base / Math.pow(10, USDC_DECIMALS);
  return base / 1e8;
}

export function settlementMemo(quoteId: string, orderId?: string) {
  return orderId
    ? `openmarket:${quoteId}:${orderId}`
    : `openmarket:${quoteId}`;
}
