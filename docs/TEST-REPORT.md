# Test report — 2026-07-24 (pre-mainnet)

## Automated

| Suite | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `vitest` unit (settlement + policy) | **14/14 PASS** |
| Hardhat escrow contract | **23/23 PASS** |
| `scripts/live-probe.sh` @ https://agentbazaar.app | **ALL PASS** |
| `scripts/e2e-usdc.ts` (real testnet USDC pay→fulfill) | **USDC E2E OK** |

## Live probe coverage

- Health / ready / TLS
- Pages: `/`, catalog, how-it-works, **terms**, **privacy**, dashboard, discovery files
- Branding: AgentBazaar, English homepage
- API: search → register → quote (fee + payTo fields)
- Settlement path (separate): USDC transfer verified + order completed

## Network

Still **Hedera testnet**. No real-money mainnet yet.

## Legal pages

- https://agentbazaar.app/terms
- https://agentbazaar.app/privacy

Draft ToS/Privacy for pre-mainnet; counsel review before large mainnet volume.
