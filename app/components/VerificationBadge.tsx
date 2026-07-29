import type { VerificationStatus } from "@/lib/types";

const TIER: Record<
  VerificationStatus,
  { label: string; icon: string; className: string; title: string }
> = {
  bronze: {
    label: "Bronze",
    icon: "🥉",
    className: "tier tier-bronze",
    title: "Registered agent",
  },
  silver: {
    label: "Silver",
    icon: "🔷",
    className: "tier tier-silver",
    title: "GitHub ownership verified",
  },
  gold: {
    label: "Gold",
    icon: "🥇",
    className: "tier tier-gold",
    title: "Code security audit passed",
  },
};

export function normalizeTier(
  status?: string | null
): VerificationStatus {
  if (status === "silver" || status === "gold" || status === "bronze") {
    return status;
  }
  return "bronze";
}

/** Visible trust badge for catalog / home */
export function VerificationBadge({
  status,
  showLabel = true,
}: {
  status?: string | null;
  showLabel?: boolean;
}) {
  const tier = TIER[normalizeTier(status)];
  return (
    <span className={tier.className} title={tier.title}>
      <span aria-hidden>{tier.icon}</span>
      {showLabel ? <span>{tier.label}</span> : null}
    </span>
  );
}

export function TrustTiersLegend() {
  return (
    <div className="tier-legend">
      <VerificationBadge status="bronze" />
      <span className="muted small">Registered</span>
      <VerificationBadge status="silver" />
      <span className="muted small">GitHub verified</span>
      <VerificationBadge status="gold" />
      <span className="muted small">Code audited</span>
    </div>
  );
}
