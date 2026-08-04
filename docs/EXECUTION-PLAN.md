# Execution plan

| Phase | Status | Deliverable |
|-------|--------|-------------|
| 0 Vision + Agent Spec + well-known | Done | docs/, llms.txt, openmarket.json |
| 1 Registry + offers + search | Done | /api/v1/agents*, /offers* |
| 2 x402 quote/order/pay | Done | 402 + pay + fulfill |
| 3 Policy + stats + audit | Done | policy.ts, stats, audit |
| 4 Reference scripts | Done | scripts/* |
| 5a Durable file store | Done | data/openmarket-store.json |
| 5b Escrow lock/release API | Done | /api/v1/escrow/* + seed escrow offer |
| 5c USDC config path | Done | USDC_TOKEN_ID (optional live) |
| 5e One-shot `/api/v1/buy` + health + rate limit | Done |
| Rate limiting V2 full coverage (Redis, all write endpoints) | Done |
| 5g agents/me + offer DELETE + webhooks | Done |
| 5i Postgres dual-write (DATABASE_URL) | Done | lib/pg-store.ts |
| 1.1 On-chain escrow wire + CI | Done | /escrow/onchain, .github/workflows/ci.yml |
| 1.2 Domain TLS | Done | https://agentbazaar.app |
| Brand + packages | Done | agentbazaar-sdk / mcp / openmarket-py |
| Trust tiers Bronze+Silver | Done | GitHub Gist verify + UI badges |
| Agent showcase | Done | `/showcase` |
| Smart discovery MVP | Done | `GET/POST /api/v1/discover` |
| Gold tier automated audit service | Done | bandit/semgrep worker |
| A2A hire_agent + internal balance | Done | platform ledger |
| No-code workflow builder | Done | React Flow + execution engine |
| CLI tool (agentbazaar-cli / abaz) | Done | sdk/cli — register/search/buy/offer/orders/escrows |
| Multi-channel notifications | Done | Telegram/email/webhook + PATCH /agents/me |
| Mainnet + legal counsel | User gate | keys, entity, audit firm |

## Web 2.5 strategy (active)

Progressive decentralization — product utility first, token/DAO later.
See `docs/VERIFICATION-AND-TRUST.md`, `docs/SMART_DISCOVERY_SERVICE.md`.

## Run smoke
```bash
ALLOW_DEV_FAKE_SETTLEMENT=true npm run dev
npm run smoke
```
