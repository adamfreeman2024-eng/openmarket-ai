/**
 * Fiat on-ramp provider interface (Task 6.4 — scaffold).
 *
 * Design: a single provider-agnostic interface so the platform can plug in
 * Stripe / Unlimit / IDram (or any other PSP) behind one code path.
 * Until an operator sets provider credentials, every method reports
 * `configured: false` and the API returns 501 NOT_CONFIGURED.
 *
 * Env wiring (all optional — absent => not configured):
 *   FIAT_PROVIDER               = "stripe" | "unlimit" | "idram" | ""
 *   FIAT_CURRENCY               = "USD" (default)
 *   Stripe:  FIAT_STRIPE_SECRET_KEY, FIAT_STRIPE_WEBHOOK_SECRET
 *   Unlimit: FIAT_UNLIMIT_API_KEY, FIAT_UNLIMIT_BASE_URL
 *   IDram:   FIAT_IDRAM_MERCHANT_ID, FIAT_IDRAM_SECRET
 */

export type FiatProvider = "stripe" | "unlimit" | "idram";

export type FiatPaymentIntent = {
  id: string;
  provider: FiatProvider;
  amount: number; // human units, e.g. USD
  currency: string;
  checkoutUrl: string | null; // hosted checkout (Unlimit/IDram) or null for Stripe
  clientSecret: string | null; // Stripe PaymentIntent client secret
  status: "created";
  createdAt: string;
};

export type FiatVerifyResult = {
  ok: boolean;
  paymentId?: string;
  amount?: number;
  currency?: string;
  error?: string;
};

export function getFiatConfig() {
  const provider = (process.env.FIAT_PROVIDER?.trim() || "").toLowerCase() as
    | FiatProvider
    | "";
  const currency = (process.env.FIAT_CURRENCY?.trim() || "USD").toUpperCase();

  const creds: Record<FiatProvider, boolean> = {
    stripe: Boolean(
      provider === "stripe" &&
        process.env.FIAT_STRIPE_SECRET_KEY?.trim() &&
        process.env.FIAT_STRIPE_WEBHOOK_SECRET?.trim()
    ),
    unlimit: Boolean(
      provider === "unlimit" &&
        process.env.FIAT_UNLIMIT_API_KEY?.trim() &&
        process.env.FIAT_UNLIMIT_BASE_URL?.trim()
    ),
    idram: Boolean(
      provider === "idram" &&
        process.env.FIAT_IDRAM_MERCHANT_ID?.trim() &&
        process.env.FIAT_IDRAM_SECRET?.trim()
    ),
  };

  const configuredProvider = (provider
    ? Object.keys(creds).find((k) => creds[k as FiatProvider])
    : undefined) as FiatProvider | undefined;

  return {
    provider,
    currency,
    configured: Boolean(configuredProvider),
    configuredProvider,
    creds,
  };
}

/**
 * Create a fiat payment intent. Throws NOT_CONFIGURED (as a tagged error)
 * when no provider credentials are present — the API route maps that to 501.
 */
export async function createFiatPayment(input: {
  amount: number;
  currency?: string;
  agentId: string;
  memo?: string;
}): Promise<FiatPaymentIntent> {
  const cfg = getFiatConfig();
  if (!cfg.configured || !cfg.configuredProvider) {
    const err = new Error("NOT_CONFIGURED: no fiat provider credentials set");
    (err as Error & { code: string }).code = "NOT_CONFIGURED";
    throw err;
  }
  const p = cfg.configuredProvider;
  const currency = (input.currency || cfg.currency).toUpperCase();

  // --- Provider-specific calls go here when creds exist. ---
  // Stripe:  stripe.paymentIntents.create({ amount: cents, currency, metadata })
  // Unlimit: POST {base}/payments with apiKey → hosted checkoutUrl
  // IDram:   build signed request to idram.am with merchantId+secret
  // Until implemented, we still return a stable contract shape so the
  // platform code path (deposit/fiat) never changes again.
  return {
    id: `fiat_${p}_${Date.now().toString(36)}`,
    provider: p,
    amount: input.amount,
    currency,
    checkoutUrl: null,
    clientSecret: null,
    status: "created",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Verify a completed fiat payment (webhook-driven or direct lookup).
 * Scaffold: without provider creds it is never OK (501 upstream).
 */
export async function verifyFiatPayment(paymentId: string): Promise<FiatVerifyResult> {
  const cfg = getFiatConfig();
  if (!cfg.configured || !cfg.configuredProvider) {
    return { ok: false, error: "NOT_CONFIGURED" };
  }
  // Provider lookup goes here (Stripe retrieve / Unlimit status / IDram).
  return { ok: false, error: "PROVIDER_LOOKUP_NOT_IMPLEMENTED" };
}

/** True when fiat on-ramp is wired (provider + creds present). */
export function isFiatConfigured(): boolean {
  return getFiatConfig().configured;
}
