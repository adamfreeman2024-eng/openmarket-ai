# Execution plan

| Phase | Status | Deliverable |
|-------|--------|-------------|
| 0 Vision + Agent Spec + well-known | Done | docs/, llms.txt, openmarket.json |
| 1 Registry + offers + search | Done | /api/v1/agents*, /offers* |
| 2 x402 quote/order/pay | Done | 402 + pay + fulfill |
| 3 Policy + stats + audit | Done | policy.ts, stats, in-mem audit |
| 4 Reference scripts | Done | scripts/demo-*.ts, smoke |
| 5 Durable DB + USDC + escrow + mainnet | Next | Supabase, HTS USDC, escrow module |

## Next engineering
1. Postgres/Supabase adapters for store.ts  
2. Real operator payTo + amount verify from mirror transfers  
3. USDC token id config + associate  
4. Escrow state machine (from hedera-escrow-agent)  
5. Wire Spend Guardian policies as pluggable package  
6. Deploy Hostinger/Vercel  
