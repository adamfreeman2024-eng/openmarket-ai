# Changelog

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
