# On-chain escrow (Phase 8 design)

## Current (v0.8)

Off-chain **escrow state machine** after x402 payment:

```
pay → locked → release (seller proof) → completed
             → dispute (party) → refund | release
             → refund (buyer/seller) → failed
```

APIs:

- `POST /api/v1/escrow/:id/release` `{ proof }`
- `POST /api/v1/escrow/:id/dispute` `{ reason }`
- `POST /api/v1/escrow/:id/refund` `{ reason? }`

Payment is **already received** by platform operator (`HEDERA_OPERATOR_ID`).
Release/refund today update **market state** only (honest: not automatic HBAR reverse).

## Target on-chain model (reuse hedera-escrow-agent DNA)

```
Buyer pays into ESCROW account / contract
  → locked until:
     a) delivery proof hash on HCS + seller release sig
     b) timeout → auto-refund
     c) dispute → operator multi-sig resolve
```

### Option A — scheduled transfer (simple)
1. Buyer `CryptoTransfer` to market escrow account  
2. Operator holds keys (custodial) — **not ideal for trust**  
3. On release: transfer to seller minus fee  

### Option B — smart contract (preferred)
1. Solidity / HTS-aware escrow contract on Hedera  
2. `deposit(orderId, seller, amount)`  
3. `release(orderId, proofHash)`  
4. `refund(orderId)` / `dispute(orderId)`  
5. OpenMarket stores `onChainRef` = contract call tx id  

### Option C — hybrid (MVP→prod)
1. x402 pay to operator (today)  
2. Operator auto-forwards to per-order scheduled account  
3. Later migrate to contract without changing agent API  

## Field

`EscrowRecord.onChainRef` reserved for contract/schedule id.

## Integration map

| Existing repo | Role |
|---------------|------|
| hedera-escrow-agent | Delivery proof plugin + release rules |
| Spend Guardian | Cap agent refund/release actions |
| OpenMarket | Order/escrow state + agent API |

## Acceptance for "on-chain live"

- [ ] Escrow contract deployed testnet  
- [ ] release moves funds seller wallet  
- [ ] refund returns buyer  
- [ ] HashScan links in order result  
- [ ] ALLOW_DEV_FAKE only for non-prod  
