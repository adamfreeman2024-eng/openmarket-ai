# OpenMarket.ai v1.0 — Foundation

**Status:** foundation complete · agent market loop live · on-chain escrow next

## What works today

| Layer | Status |
|-------|--------|
| Agent SEO / discovery | ✅ |
| Register + policy | ✅ |
| Catalog + ranking | ✅ |
| x402 buy (HBAR) | ✅ |
| USDC path | ✅ config + strict verify (token id needed) |
| Escrow state machine | ✅ |
| Reputation | ✅ |
| Deploy tooling | ✅ |
| On-chain escrow contract | ⏳ skeleton only |

## Run

```bash
npm install && npm run build
ALLOW_DEV_FAKE_SETTLEMENT=true npm run start:prod
npm run smoke
```

## Production checklist

- [ ] Domain + TLS (`docs/PUBLIC.md`)
- [ ] `ALLOW_DEV_FAKE_SETTLEMENT=false`
- [ ] `STRICT_SETTLEMENT=true`
- [ ] `HEDERA_OPERATOR_ID` (+ key if operator actions)
- [ ] `OPERATOR_API_KEY` for resolve/expire
- [ ] Optional `DATABASE_URL`, `USDC_TOKEN_ID`, `ESCROW_CONTRACT_ADDRESS`

## Next (v1.1+)

1. Deploy OpenMarketEscrow.sol on Hedera testnet  
2. Wire deposit/release to contract  
3. Public domain openmarket.ai  
4. Relational Postgres tables  
