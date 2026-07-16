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
| 5n Escrow dispute + refund + agent stats | Done |
| 5o ONCHAIN-ESCROW design | Done | docs/ONCHAIN-ESCROW.md |
| 6 Full relational Postgres tables | Next |
| 7 Domain DNS + TLS | Next (user DNS) |
| 8 On-chain escrow contract | Later |

## Run smoke
```bash
ALLOW_DEV_FAKE_SETTLEMENT=true npm run dev
npm run smoke
```
