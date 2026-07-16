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
| 5g agents/me + offer DELETE + webhooks | Done |
| 5i Postgres dual-write (DATABASE_URL) | Done | lib/pg-state.ts |
| 1.0 Foundation freeze | Done | docs/FOUNDATION-1.0.md + CHANGELOG |
| 1.1 Deploy escrow contract testnet | Next | |
| 1.2 Domain TLS | Next | |
| 1.3 Relational Postgres | Later | |

## Run smoke
```bash
ALLOW_DEV_FAKE_SETTLEMENT=true npm run dev
npm run smoke
```
