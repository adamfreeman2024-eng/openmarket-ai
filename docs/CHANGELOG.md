# Changelog

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
