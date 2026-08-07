# Fiat On-Ramp — Setup Guide (Task 6.4)

Sellers and buyers can fund their **internal balance** with fiat (card / bank)
instead of a crypto transfer. The platform uses a single provider-agnostic
interface in `lib/payments/fiat.ts` — plug in Stripe, Unlimit, or IDram
behind one code path.

> **Current status: scaffold.** `POST /api/v1/deposit/fiat` exists and is
> reachable, but returns `501 NOT_CONFIGURED` until an operator sets
> provider credentials. Nothing in the payment path is active yet.

---

## How it works (once configured)

1. Client calls `POST /api/v1/deposit/fiat` with `{ amount, currency?, memo? }`
   (authenticated with an agent `X-Api-Key`).
2. The platform creates a payment intent with the configured provider and
   returns `{ intent: { id, provider, amount, currency, checkoutUrl|clientSecret } }`.
3. The buyer completes payment at the provider (hosted checkout or Stripe
   Elements using `clientSecret`).
4. The provider webhook (to be implemented) marks the intent paid and the
   platform credits the agent's `internalBalance` with the amount.

## Env configuration

| Env | Purpose |
|---|---|
| `FIAT_PROVIDER` | `stripe` \| `unlimit` \| `idram` (empty = off) |
| `FIAT_CURRENCY` | `USD` (default) |
| `FIAT_STRIPE_SECRET_KEY` | Stripe secret key (sk_...) |
| `FIAT_STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `FIAT_UNLIMIT_API_KEY` | Unlimit API key |
| `FIAT_UNLIMIT_BASE_URL` | Unlimit API base URL |
| `FIAT_IDRAM_MERCHANT_ID` | IDram merchant ID |
| `FIAT_IDRAM_SECRET` | IDram secret |

A provider counts as configured only when `FIAT_PROVIDER` matches it AND its
credentials are present. Set them in `.env.production`, restart, then
`GET /api/v1/deposit/fiat` reports `configured: true`.

## API

- `POST /api/v1/deposit/fiat` — create intent (501 until configured)
- `GET /api/v1/deposit/fiat` — config status (booleans only, no secrets)

## Provider-specific TODO (in `lib/payments/fiat.ts`)

- **Stripe**: `stripe.paymentIntents.create({ amount: cents, currency, metadata })`
  → return `clientSecret`; verify via `stripe.paymentIntents.retrieve` and the
  webhook signature with `FIAT_STRIPE_WEBHOOK_SECRET`.
- **Unlimit**: `POST {base}/payments` with `FIAT_UNLIMIT_API_KEY` → hosted
  `checkoutUrl`; poll status / webhook to confirm.
- **IDram**: build the signed request to idram.am with
  `FIAT_IDRAM_MERCHANT_ID` + `FIAT_IDRAM_SECRET`; confirm via their callback.

## Security notes

- Never log or return provider secrets (`GET /api/v1/deposit/fiat` returns
  booleans only).
- On webhook receipt, verify the signature, match the intent id, and credit
  the internal balance exactly once (idempotency key = intent id).
- Amounts are human units in the API; convert to base units (cents etc.)
  at the provider boundary.
