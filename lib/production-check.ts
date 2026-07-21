/**
 * Production readiness checks — fail loud when misconfigured.
 */

export type Check = {
  id: string;
  ok: boolean;
  severity: "critical" | "high" | "medium" | "info";
  message: string;
};

export function productionChecks(): {
  ready: boolean;
  productionMode: boolean;
  checks: Check[];
} {
  const nodeEnv = process.env.NODE_ENV || "development";
  const productionMode = nodeEnv === "production";
  const checks: Check[] = [];

  const site = process.env.NEXT_PUBLIC_SITE_URL || "";
  const fake =
    process.env.ALLOW_DEV_FAKE_SETTLEMENT === "true" ||
    process.env.ALLOW_DEV_FAKE_SETTLEMENT === "1";
  const strict =
    process.env.STRICT_SETTLEMENT === "true" ||
    process.env.STRICT_SETTLEMENT === "1" ||
    (!fake && process.env.STRICT_SETTLEMENT !== "false");
  const opId = process.env.HEDERA_OPERATOR_ID?.trim() || "";
  const opKey = process.env.HEDERA_OPERATOR_KEY?.trim() || "";
  const escrow = process.env.ESCROW_CONTRACT_ADDRESS?.trim() || "";
  const dbUrl = process.env.DATABASE_URL?.trim() || "";
  const opApi = process.env.OPERATOR_API_KEY?.trim() || "";
  const usdc = process.env.USDC_TOKEN_ID?.trim() || process.env.NEXT_PUBLIC_USDC_TOKEN_ID?.trim() || "";

  checks.push({
    id: "site_url",
    ok: Boolean(site) && !site.includes("localhost") && site.startsWith("https://"),
    severity: productionMode ? "critical" : "medium",
    message: site
      ? `SITE_URL=${site}`
      : "NEXT_PUBLIC_SITE_URL missing (need public https URL)",
  });

  checks.push({
    id: "dev_fake_off",
    ok: !fake,
    severity: "critical",
    message: fake
      ? "ALLOW_DEV_FAKE_SETTLEMENT is ON — disable for production"
      : "devFakeSettlement disabled",
  });

  checks.push({
    id: "strict_settlement",
    ok: strict,
    severity: "high",
    message: strict ? "STRICT_SETTLEMENT active" : "STRICT_SETTLEMENT off — payments may soft-pass",
  });

  checks.push({
    id: "operator_credentials",
    ok: Boolean(opId && opKey && !opId.includes("xxxxx")),
    severity: "critical",
    message: opId && opKey ? `operator ${opId}` : "HEDERA_OPERATOR_ID/KEY missing",
  });

  checks.push({
    id: "escrow_contract",
    ok: Boolean(escrow && escrow.startsWith("0x")),
    severity: "high",
    message: escrow ? `escrow ${escrow}` : "ESCROW_CONTRACT_ADDRESS not set",
  });

  checks.push({
    id: "database",
    ok: Boolean(dbUrl),
    severity: productionMode ? "high" : "info",
    message: dbUrl ? "DATABASE_URL set (dual store)" : "DATABASE_URL unset — file store only",
  });

  checks.push({
    id: "operator_api_key",
    ok: Boolean(opApi && opApi.length >= 16 && !opApi.includes("change-me")),
    severity: "high",
    message: opApi && opApi.length >= 16 ? "OPERATOR_API_KEY set" : "OPERATOR_API_KEY weak/missing",
  });

  checks.push({
    id: "usdc",
    ok: Boolean(usdc),
    severity: "info",
    message: usdc ? `USDC ${usdc}` : "USDC_TOKEN_ID optional — HBAR-only settlement",
  });

  checks.push({
    id: "network",
    ok: true,
    severity: "info",
    message: `network=${process.env.NEXT_PUBLIC_HEDERA_NETWORK || "testnet"} (mainnet when go-live)`,
  });

  const blocking = checks.filter(
    (c) => !c.ok && (c.severity === "critical" || (productionMode && c.severity === "high"))
  );

  return {
    ready: blocking.length === 0,
    productionMode,
    checks,
  };
}
