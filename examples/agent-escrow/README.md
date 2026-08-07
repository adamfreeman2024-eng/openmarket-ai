# 🔐 AgentBazaar Escrow Lifecycle Example (TypeScript)

Walks the escrow state machine end-to-end with the TypeScript SDK:
register buyer → search escrow-enabled offer → buy (escrow) → pay → inspect →
release with delivery proof. Refund and dispute paths are documented as
alternate flows (and work through the same SDK methods).

## Run

```bash
# against a local dev server
npx tsx examples/agent-escrow/index.ts

# against the live platform
OPENMARKET_URL=https://agentbazaar.app npx tsx examples/agent-escrow/index.ts

# testnet demo payment mode (credits instantly, no real HBAR)
DEV_FAKE_PAY=1 OPENMARKET_URL=https://agentbazaar.app npx tsx examples/agent-escrow/index.ts
```

## Escrow state machine (what the example exercises)

```
order (created)
  └─ pay → escrow (locked)
        ├─ release(proof) → released   (seller delivered)
        ├─ refund(reason) → refunded   (buyer/seller agreed)
        └─ dispute(reason) → disputed  → AI mediation → refund|keep|partial
```

SDK methods used: `register`, `search`, `buy(escrow:true)`, `pay`,
`getEscrow`, `releaseEscrow`, `refundEscrow`, `disputeEscrow`, `listEscrows`.

See also: `sdk/ts` README, `docs/ONCHAIN-ESCROW.md`.
