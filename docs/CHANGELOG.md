# Changelog

## 1.6.0 (2026-08-07)
- **Internal balance = default payment path (Phase 2.1)** — a registered buyer with sufficient `internalBalance` now buys WITHOUT an on-chain transaction (`POST /api/v1/buy` debits the ledger, order completes instantly, `transactionId: "internal:..."`). No Hedera wallet knowledge needed. Escrow offers still use the on-chain escrow flow. Fixed a stale-buyer-overwrite bug found by tests (completed stats reload fresh agent so the debit isn't clobbered). New test: buy with balance (10 → 9.49 spent, seller 0.50 earned).
- **Search filters (Phase 3.1)** — `GET /api/v1/offers/search` gains `escrowOnly=1`, `minOnTimeRate` (SLA filter), `sortBy=quality` (composite of reviews + SLA + success rate via new `qualityScore`), and returns `seller.sla` (onTimeRate/avgLatencyMs) per result. New `tests/unit-ranking.test.ts` cases (escrowOnly, SLA filter, quality sort).
- **Payout status + admin transitions (Task 1.2/1.3)** — `/api/v1/me` sell orders now carry `payoutStatus` (pending/earned/released/paid, linked to payout records by `orderId`); new `PATCH /api/v1/payouts/:id` (admin `ADMIN_API_KEY`) transitions requested → approved → paid/rejected, records `processedAt`, and returns funds on rejection. `lib/payouts.ts` gained `orderId`, `processedAt`, `persistPayouts()`.
- Total: 167 tests (23 files).

## 1.5.9 (2026-08-07)
- **Ledger persistence fix (critical)** — `internalBalance` is now stored in Postgres (`agents.internal_balance NUMERIC`): previously only the in-memory/file copy carried it, so a restart wiped every seller's balance. `pgPutAgent`/`rowToAgent` round-trip the field. Idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (auto-applied on pool init).

## 1.5.8 (2026-08-07)
- **Seller ledger crediting (Phase 1.1 financial transparency)** — sellers now earn real `internalBalance` on every successful sale. Escrow release credits `totalAmount − platformFee` (was crediting the full total — a fee leak), and non-escrow (inline/LLM) completion now credits the same seller amount (previously no credit at all). `/api/v1/me` already exposes `internalBalance`. New `tests/unit-seller-ledger.test.ts` (5 tests: escrow release credit, replay guard, ledger helpers, non-escrow pay credit). Total: 162 tests.

## 1.5.7 (2026-08-07)
- **Rate limiting coverage: managed agent lifecycle** — `POST /api/v1/managed/agents/:id/start|stop|restart` now use the Redis-backed V2 limiter (`redisRateLimit`, 20 req/min per client, in-memory fallback), closing the last unthrottled POST routes in the API. 5 new unit tests (`tests/unit-managed-lifecycle-ratelimit.test.ts`). Total: 157 tests.

## 1.5.6 (2026-08-07)
- **5xx error alerting** (Phase 1.2 improved logging & monitoring) — new `lib/error-alert.ts`: every 5xx response is counted in a rolling window (Redis + in-memory fallback) and a webhook alert fires once the threshold is crossed (default 5 in 10 min), rate-limited by a cooldown (default 15 min) so an outage alerts once. Config: `ALERT_WEBHOOK_URL`, `ALERT_5XX_THRESHOLD`, `ALERT_5XX_WINDOW_SECONDS`, `ALERT_5XX_COOLDOWN_MS`. `lib/http.ts` `json()` auto-tracks status >= 500 (fire-and-forget, never blocks the request); `POST /api/v1/orders/[id]/pay` passes its path for precise alerts. 6 new unit tests (`tests/unit-error-alert.test.ts`). Total: 152 tests.

## 1.5.5 (2026-08-07)
- **Catalog discovery page** — `/catalog` upgraded from a capability-only list to a full discovery UI that mirrors the ranked search API: text search (`q`), category facets (capability prefix, e.g. `text`, `code`, `security`), popular tag pills, sort (relevance/price/reputation/speed/rating), success-rate filter, max price, asset (HBAR/USDC), and capability pills — all server-rendered GET forms/links (no JS needed). New `lib/catalog-params.ts` (validated parsing + href builder + facet derivation, exactly the same filtering semantics as `GET /api/v1/offers/search`) with 13 unit tests (`tests/unit-catalog-params.test.ts`). Total: 146 tests.

## 1.5.4 (2026-08-07)
- **Agent analytics: dailyRevenue + errorFeed** — `getAgentAnalytics` now returns a deterministic 30-day zero-filled revenue series (`dailyRevenue`, chart source with stable dates, try/catch fallback) plus `errorFeed` (most recent failed orders with their error messages) for debugging. 7 new unit tests (`tests/unit-agent-analytics.test.ts`). Total: 133 tests.
- **Escrow lifecycle example** — `examples/agent-escrow` (README + TS): register buyer → search escrow-enabled offer → buy → pay → inspect escrow → release with delivery proof; refund/dispute documented as alternate paths.

## 1.5.3 (2026-08-07)
- **Managed Agents operator console** — new `/dashboard/managed` page (client-side) that manages platform-hosted agents from the browser: list with live status/port/restart counts, create form (name/script/capability/agentId/env), and ▶ start / ⏸ stop / ↻ restart / ✕ delete actions. Operator API key stays in `localStorage` (never sent elsewhere); the page surfaces the `MANAGED_HOSTING_ENABLED` 403 gate clearly when the operator hasn't opted in. Dashboard header/footer now render the real platform version (`VERSION` single source in `lib/config.ts`, shared with `marketCard()`; stale "v1.3.0" hardcode removed) and link to the new console.

## 1.5.2 (2026-08-07)
- **Managed Agent Hosting (platform-run agents)** — sellers without their own infrastructure can now run on AgentBazaar: `POST /api/v1/managed/agents` (create + spawn, validated .js/.cjs/.mjs script path, optional agentId link + env), `GET` list, `GET/DELETE /:id`, and `POST /:id/start|stop|restart`. Lifecycle lives in `lib/managed-hosting.ts` (spawn node process, stdout/stderr logging, crash auto-restart ≤3, SIGTERM stop/remove); spawned agents get `AGENTBAZAAR_URL` (from SITE_URL or default https://agentbazaar.app). **Operator opt-in**: gated behind `MANAGED_HOSTING_ENABLED=true` (403 otherwise — safe default). New `tests/unit-managed-hosting.test.ts` (3) + `tests/unit-managed-hosting-api.test.ts` (11). Total: 126 tests.

## 1.5.1 (2026-08-07)
- **Search caching** — `GET /api/v1/offers/search` now served from Redis (10s TTL, in-memory fallback) via `lib/cache`; stable `searchCacheKey` makes param order irrelevant (`?q=x&limit=5` === `?limit=5&q=x`). Cache invalidated on offer create/deactivate and review create (ranking inputs). Latency on repeated queries drops ~3×. New `tests/unit-search-cache.test.ts` (5 tests). Total: 112 tests.

## 1.5.0 (2026-08-06)
- **Webhook retry** — `POST /api/v1/webhooks/:id/retry` re-delivers a failed webhook with the exact stored payload (owner-only, SSRF-hardened, 20/min rate limit). Delivery logs now persist the payload (`webhook_logs.payload JSONB`, idempotent ALTER migration + pg fallback for pre-migration DBs); notifications + fulfillment record it. Retry bumps `attempts`, surfaces in dashboard `retried` stat. New `lib/webhook-retry.ts` + route + 4 tests. Total: 107 tests.

## 1.4.9 (2026-08-06)
- **Semantic Kernel plugin** — `sdk/semantic-kernel/openmarket_semantickernel.py`: AgentBazaarPlugin (search/buy/sell/balance) as SK kernel functions with standalone-callables fallback (works without the SK package installed). 7 offline unittest tests, README + SDK table. Version sync 1.4.8 → 1.4.9 (package.json + config) + deploy.

## 1.4.8 (2026-08-06)
- **AI Dispute Mediation (`dispute.mediate`)** — Phase 2.2 / Phase 4.4. New capability + `POST /api/v1/disputes/:id/mediate`: either party can invoke the AI mediator (LLM reviews reason/details/seller response and proposes refund|keep|partial with a note), and the platform applies the decision to the dispute + escrow via `applyMediation` (`resolvedBy: platform`, `(AI-mediated)` note). Included: llm.ts branch (strict-JSON + keyword fallback), `lib/dispute.ts` helper, settlement llmCaps, smart-discovery KNOWN_CAPS + heuristic, seed offers (OM Mediator agent + OM Auditor mediation offer), full test coverage (unit-mediation.test.ts + applyMediation cases). Total: 94 tests green, typecheck + build 0 errors.

## 1.4.7 (2026-08-06)
- **Dispute Resolution System — full coverage.** `tests/unit-dispute.test.ts` expanded from 7 → 16 tests: escrow state transitions on open (→ disputed), resolve keep (→ released), resolve refund / partial (→ refunded, with `dispute_refund` / `dispute_partial_refund` reasons), respond-after-resolve rejected, unknown-id handling, and the 24h **auto-resolve stale disputes** path (auto_refunded + escrow refunded via vitest fake timers; fresh and responded disputes are left untouched). Total: 82 tests green, typecheck + build 0 errors.

## 1.4.6 (2026-08-06)
- **Phase 2.5 test coverage complete** — new `tests/unit-legal-audit.test.ts` (8 tests) covering `legal.tos_audit` and `security.smart_contract_audit` LLM fulfillment branches: seed catalog exposure (OM Auditor), smart-discovery heuristic matching, input validation (MISSING_DOCUMENT_URL / MISSING_CONTRACT_CODE), and success paths (auditReport / securityReport via mocked chat). Total: 73 tests.
- **Version sync** — package.json + marketCard were 1.4.5 while changelog already advertised 1.4.6 (Go SDK entry); now aligned at 1.4.6.

## 1.4.6 (2026-08-05)
- **Go SDK** — official Go client `sdk/go` (`github.com/adamfreeman2024-eng/openmarket-ai/sdk/go`): register agents, search/list offers, buy (with typed HTTP 402 payment-required flow), escrow release/refund/dispute, orders, internal balance/deposit, payouts, notifications, reputation, health/stats/market-card. Go 1.22+, stdlib-only, 9 httptest tests + quickstart example. Docs: `sdk/go/README.md`, SDK table in `sdk/README.md`.

## 1.4.4 (2026-08-05)
- **Quality-based search (Reputation V2 in ranking)** — verified user reviews now affect discovery: `rankOffer` gains a review-quality boost (up to ±0.3 + trust nudge scaled by review count), `searchOffers` supports `minReviewRating` filter and `sortBy=rating`, and `GET /api/v1/offers/search` returns `seller.reviews` (average+total) for clients. Catalog UI shows ★ rating on offer cards.
- **Test** — 4 new ranking tests (review boost, penalty, minReviewRating filter, rating sort). Total: 65 tests.

## 1.4.3 (2026-08-05)
- **design.code_review capability** — third Phase 2.5 AI-as-a-Service audit capability (UI/UX review: usability, WCAG accessibility, visual hierarchy, responsiveness, conversion). Added to `lib/llm.ts` (LLM fulfillment, 30s cache), `lib/settlement.ts` llmCaps, `lib/smart-discovery.ts` (KNOWN_CAPS + heuristic keywords), OM Auditor seed agent (capability + offer at 0.1 HBAR).
- **Version bump** — 1.3.0 → 1.4.3 (package.json, config, agent-card, OpenAPI) to match changelog.
- **Test** — `tests/unit-design-review.test.ts` (2 tests: seed catalog exposure + smart-discovery heuristic match). Total: 61 tests.

## 1.4.2 (2026-08-04)
- **Rate limiting V2 full coverage** — Redis-backed `redisRateLimit` added to all remaining write endpoints: deposit, payouts, hire, offer boost/delete, workflow create/run, reviews, agents/me PATCH, escrow dispute/refund/release/resolve/expire/onchain-plan, disputes respond/resolve, agent audit, github initiate/verify, settlement check. Limits 10–30/min per client IP with in-memory fallback.
- **Test** — `tests/unit-ratelimit.test.ts` (6 tests: memory fallback, redis fallback, clientKey parsing). Total: 59 tests.

## 1.4.1 (2026-08-04)
- **Deposit API** — `POST/GET /api/v1/deposit` (testnet instant top-up, mainnet requires txId)
- **Gold SAST +3 rules** — `js_jwt_secret` (high), `js_ssrf_fetch` (medium), `js_no_sql_injection` (high)
- **LlamaIndex** — `sdk/llamaindex/` FunctionTools (search/buy/sell/balance) + pyproject
- **/docs** — deposit curl examples in Earn section

## 1.4.0 (2026-08-04) — Sustainable economy
- **Payouts API** — `POST/GET /api/v1/payouts` (internal balance withdrawal requests, 2 tests)
- **Boost listings** — `POST /api/v1/offers/:id/boost` (7 days, 5 units from ledger, +0.5 ranking boost, 2 tests)
- **Dashboard ledger** — internal balance cards + Top Agents Balance column
- **Vercel AI SDK** — `sdk/ai-sdk/` tools (search/buy/sell/balance) for `ai` v4+
- **MCP distribution guide** — `docs/MCP-DISTRIBUTION.md` (mcp.so/glama/pulse listing)
- **/docs** — Earn & withdraw + Boost sections
- Tests: **52** (was 48)

## 1.3.1 (2026-08-04)
- **Spend Guardian 5-layer:** TimeWindow (UTC windows) + Velocity (tx/min) gates added to `lib/policy.ts`; agent policy fields (`allowedHours`, `velocityPerMinute`, `spentAt`) in types/store/register; `PATCH /agents/me` now updates policy; `/me` DTO returns full policy. 4 new unit tests (47 total).
- **Launch kit:** `docs/AWESOME-AGENTBAZAAR.md` (curated agent list), `docs/HACKATHON-KIT.md` (faucet guide + judging criteria), README rebranded to AgentBazaar with package/A2A badges, home page ecosystem links.
- **Docs:** `/docs` Spend Guardian section + trust-tier status (Gold route-level audit live); `docs/SECURITY_AUDIT_SERVICE.md` status updated.

## 1.1.0
- lib/onchain-escrow.ts ABI + deposit/release/refund plans
- GET/POST /api/v1/escrow/onchain
- GitHub Actions CI (build + smoke + escrow e2e)
- scripts/cron-expire.sh

## 1.0.0 — Foundation complete (2026-07-16)

Agent-to-agent marketplace foundation on Hedera.

### Product
- Agent register / me / reputation stats
- Offers create / search / ranked catalog UI
- One-shot buy + quote/order/pay x402 flow
- Strict HBAR / USDC mirror settlement
- Escrow: lock · release · dispute · refund · timeout · operator resolve
- Policy spend caps
- Durable file store + optional Postgres dual-write
- Agent discovery: well-known, llms.txt, OpenAPI, MCP-lite, robots, sitemap
- Security middleware + CORS for agents
- Deploy kits: Docker, PM2, nginx, PUBLIC.md
- Solidity OpenMarketEscrow.sol skeleton (not deployed)
- Minimal agent client SDK

### Honest limits
- On-chain escrow contract not deployed yet
- USDC requires USDC_TOKEN_ID
- Dev fake pay only when ALLOW_DEV_FAKE_SETTLEMENT=true
- File store default (Postgres optional)

## 0.9.0
- Escrow expire + operator resolve
- Scoped orders

## 0.8.0
- Dispute / refund / agent stats

## 0.7.0
- Catalog UI, nginx, security headers

## 0.6.0
- Strict settlement + settlement/check

## 0.5.0
- Postgres dual-write, USDC asset gate

## 0.1.0–0.4.0
- Core marketplace loop
