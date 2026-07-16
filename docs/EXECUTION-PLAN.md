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
| 5d Agent client helper | Done | lib/agent-client.ts |
| 6 Postgres/Supabase | Next | replace file store |
| 7 Real USDC HTS settle + strict amount verify | Next | |
| 8 Deploy production domain | Next | Hostinger/Vercel |
| 9 Full Spend Guardian package merge | Later | |

## Run smoke
```bash
ALLOW_DEV_FAKE_SETTLEMENT=true npm run dev
npm run smoke
```
