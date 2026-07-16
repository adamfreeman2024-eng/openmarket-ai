/**
 * Deploy OpenMarketEscrow — run after hardhat is installed.
 * node scripts/deploy-escrow-notes.js
 */
console.log(`
OpenMarketEscrow deploy checklist
=================================
1. npm i -D hardhat @nomicfoundation/hardhat-toolbox
2. Set HEDERA_JSON_RPC_RELAY + DEPLOYER_KEY in .env
3. npx hardhat compile
4. Write deploy script that deploys OpenMarketEscrow(200, 259200)
5. Export ESCROW_CONTRACT_ADDRESS=0x...
6. Restart OpenMarket — market card will show escrow.onChainContract

Until then: off-chain escrow state machine is live (v0.8+).
`);
