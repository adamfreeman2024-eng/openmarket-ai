# Contracts

## OpenMarketEscrow.sol

Minimal payable escrow for Hedera EVM (testnet/mainnet).

**Not deployed in v0.9** — skeleton for Phase 8.

### Deploy (later)

```bash
# example — requires hardhat + hedera network config
npx hardhat compile
npx hardhat run scripts/deploy-escrow.js --network hederaTestnet
```

### Wire to OpenMarket

1. Deploy → `ESCROW_CONTRACT_ADDRESS`  
2. On escrow lock: call `deposit(orderIdHash, sellerEvm)` or record `onChainRef`  
3. release/refund API → contract methods  

Until then, market uses off-chain escrow state + x402 pay-to-operator.
