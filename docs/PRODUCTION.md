# OpenMarket.ai — Production readiness

**Goal:** run safely on the public internet with real settlement.

Live testnet today: `https://openmarket-ai.187-55-228-127.sslip.io`

---

## Already production-grade (done)

| Area | Status |
|------|--------|
| Real HBAR settlement (mirror strict) | ✅ |
| Escrow smart contract (Hedera testnet) | ✅ |
| USDC HTS token id wired | ✅ |
| devFakePay disabled in prod env | ✅ |
| Postgres dual store | ✅ |
| Docker non-root + healthcheck | ✅ |
| Security headers middleware | ✅ |
| Rate limit (register/buy + more) | ✅ |
| Agent self-service `/api/v1/me` | ✅ |
| Readiness `/api/v1/ready` | ✅ |
| CI + unit/contract tests | ✅ |
| HTTPS (sslip.io + Let's Encrypt) | ✅ |

---

## Pre-flight checklist (operator)

```bash
# 1. Env must match production policy
ALLOW_DEV_FAKE_SETTLEMENT=false
STRICT_SETTLEMENT=true
NEXT_PUBLIC_SITE_URL=https://YOUR_DOMAIN
NODE_ENV=production
DATABASE_URL=postgres://...@postgres:5432/openmarket
HEDERA_OPERATOR_ID=...
HEDERA_OPERATOR_KEY=...
ESCROW_CONTRACT_ADDRESS=0x...
OPERATOR_API_KEY=<long random>
USDC_TOKEN_ID=0.0....   # optional but recommended

# 2. Probes
curl -sS https://YOUR_DOMAIN/api/v1/health | jq .
curl -sS https://YOUR_DOMAIN/api/v1/ready | jq .
# ready must be HTTP 200

# 3. Backup
chmod +x scripts/backup.sh && ./scripts/backup.sh
```

---

## Go-live blockers (need you / external)

| Item | Why | Owner |
|------|-----|--------|
| **Custom domain + TLS** | Trust, SEO, stable agent discovery URLs | You (DNS) |
| **npm / PyPI publish** | One-line install for agents | You (2FA tokens) |
| **Hedera mainnet** | Real money; redeploy escrow + operator | You + Hermes |
| **External smart-contract audit** | Escrow fund safety | External auditor |
| **Monitoring alerts** | Uptime / error budget | Hermes can wire UptimeRobot/Grafana |
| **Legal / ToS / KYC policy** | Marketplace liability | You |

---

## Hardening already applied in this release

1. `/api/v1/ready` — fails if store down or critical env missing in production  
2. Health embeds `productionChecks`  
3. Rate limits on offers / quotes / orders / pay  
4. Security headers: HSTS (https), CSP-lite, `X-Request-Id`  
5. JSON body size guard (1 MB)  
6. `scripts/backup.sh` for Postgres + `/data`  
7. Stronger middleware CORS allowlist optional via `CORS_ORIGINS`

---

## Mainnet cutover (when ready)

1. Fund mainnet ECDSA operator  
2. Deploy `OpenMarketEscrow.sol` to mainnet  
3. Set `NEXT_PUBLIC_HEDERA_NETWORK=mainnet`  
4. Point USDC to mainnet HTS USDC id  
5. Disable all test endpoints / fake flags  
6. Fresh backup + run full buy cycle with small amount  

---

## Recommended next engineering (priority)

1. Domain → update `NEXT_PUBLIC_SITE_URL` + nginx server_name  
2. Publish SDKs  
3. Structured logging + log drain  
4. Redis rate-limit (multi-instance)  
5. Mainnet + audit  
