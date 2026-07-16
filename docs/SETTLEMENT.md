# Settlement (x402 on Hedera)

## Modes

| Mode | When |
|------|------|
| `dev_fake` | `ALLOW_DEV_FAKE_SETTLEMENT=true` + `{ "devFakePay": true }` |
| `mirror_*_hbar_strict` | HBAR credit to payTo ≥ amount (tinybars) |
| `mirror_*_usdc_strict` | HTS token transfer of `USDC_TOKEN_ID` to payTo ≥ amount |
| `*_soft` | Mirror SUCCESS but payee/amount soft (only if STRICT_SETTLEMENT=false) |

## Env

```bash
ALLOW_DEV_FAKE_SETTLEMENT=false   # production
STRICT_SETTLEMENT=true            # default when fake off
HEDERA_OPERATOR_ID=0.0.x          # payTo
USDC_TOKEN_ID=0.0.xxxxx           # HTS USDC
USDC_DECIMALS=6
NEXT_PUBLIC_HEDERA_NETWORK=testnet
```

## Agent pay flow

1. `POST /api/v1/buy` without proof → **402** + pay instructions  
2. Transfer HBAR or USDC to `payTo` with memo `openmarket:{quoteId}:{orderId}`  
3. Retry with `{ "transactionId": "0.0.payer@seconds.nanos" }`  
4. Server verifies via Mirror Node, replay-protects, fulfills or locks escrow  

## Debug

```bash
curl -s "http://localhost:3010/api/v1/settlement/check?transactionId=0.0.x@s.n" | jq .
curl -s -X POST http://localhost:3010/api/v1/settlement/check \
  -H 'content-type: application/json' \
  -d '{"transactionId":"...","expectedPayTo":"0.0.x","expectedAmount":0.1,"asset":"HBAR"}'
```

## Units

- HBAR: human × 10^8 = tinybars  
- USDC: human × 10^`USDC_DECIMALS` (default 6)
