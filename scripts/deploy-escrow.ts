/**
 * Deploy OpenMarketEscrow.sol to Hedera testnet or mainnet.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-escrow.ts --network hedera_testnet
 *   npx hardhat run scripts/deploy-escrow.ts --network hedera_mainnet
 *
 * Outputs the contract address — save to .env as ESCROW_CONTRACT_ADDRESS
 */
const { ethers } = require("hardhat");

async function main() {
  const feeBps = Number(process.env.PLATFORM_FEE_BPS || "200");
  const lockSeconds = Number(process.env.ESCROW_LOCK_SECONDS || 72 * 3600);

  console.log("Deploying OpenMarketEscrow...");
  console.log(`  feeBps: ${feeBps} (${feeBps / 100}%)`);
  console.log(`  lockSeconds: ${lockSeconds} (${lockSeconds / 3600}h)`);

  const Factory = await ethers.getContractFactory("OpenMarketEscrow");
  const contract = await Factory.deploy(feeBps, lockSeconds);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\n✅ OpenMarketEscrow deployed to: ${address}`);
  console.log(`\nAdd to .env:`);
  console.log(`ESCROW_CONTRACT_ADDRESS=${address}`);

  // Verify operator
  const operator = await contract.operator();
  const paused = await contract.paused();
  console.log(`\nContract state:`);
  console.log(`  operator: ${operator}`);
  console.log(`  paused: ${paused}`);
  console.log(`  platformFeeBps: ${await contract.platformFeeBps()}`);
  console.log(`  defaultLockSeconds: ${await contract.defaultLockSeconds()}`);

  return address;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
