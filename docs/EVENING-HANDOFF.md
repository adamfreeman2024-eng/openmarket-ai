# Evening handoff — OpenMarket ready platform

**Date:** 2026-07-22  
**Version:** 1.3.x  
**Status:** Testnet production-ready, public HTTPS

## Live URLs

| What | URL |
|------|-----|
| Site | https://openmarket-ai.187-55-228-127.sslip.io |
| Health | /api/v1/health |
| Ready | /api/v1/ready |
| Dashboard | /dashboard |
| Demo webhook | /api/v1/demo/fulfill |
| Agent me | /api/v1/me (X-Api-Key) |
| OpenAPI | /openapi.json |
| llms.txt | /llms.txt |
| Agent card | /.well-known/agent-card.json |
| GitHub | https://github.com/adamfreeman2024-eng/openmarket-ai |
| Escrow | https://hashscan.io/testnet/contract/0.0.9645319 |

## What Hermes completed (your “my part”)

- Security audits + settlement/escrow hardening  
- Real HBAR settlement E2E  
- USDC HTS token + verification path + `scripts/e2e-usdc.ts`  
- Webhook auto-fulfill + **public demo webhook offer**  
- Agent self-service `/api/v1/me`  
- AutoGen + LangChain + CrewAI + MCP + SDKs  
- Production pack: ready probe, rate limits, headers, backup script  
- Launch kit: `docs/LAUNCH-KIT.md`  
- Ops: backup + uptime cron (if installed)

## What you do this evening (your part)

1. **Domain** — point A/AAAA to server IP `187.55.228.127` (or current VPS IP)  
2. Tell Hermes the domain → nginx + certbot + `NEXT_PUBLIC_SITE_URL` update  
3. **npm** — enable 2FA, create granular publish token → Hermes publishes SDK  
4. Optional: post Show HN using `docs/LAUNCH-KIT.md`  
5. Optional: mainnet only when you are ready (separate checklist in PRODUCTION.md)

## Quick verify (30 seconds)

```bash
curl -sS https://openmarket-ai.187-55-228-127.sslip.io/api/v1/ready | jq .status
curl -sS https://openmarket-ai.187-55-228-127.sslip.io/api/v1/health | jq .production
```

Expect: `ready` + `failedChecks: []`

## Commands on server

```bash
cd /root/projects/openmarket-ai
npm run backup
docker compose ps
curl -s localhost:3010/api/v1/ready
```

## USDC E2E (optional re-run)

```bash
cd /root/projects/openmarket-ai
set -a && source .env && set +a
npx tsx scripts/e2e-usdc.ts
```

Platform is **ready to use and demo tonight**. Domain + npm unlock “professional launch” packaging.
