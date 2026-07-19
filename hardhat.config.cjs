/**
 * Hardhat config (CommonJS) for OpenMarket.ai — Hedera testnet/mainnet deployment.
 *
 * Usage:
 *   npx hardhat compile
 *   npx hardhat run scripts/deploy-escrow.ts --network hedera_testnet
 *   npx hardhat run scripts/deploy-escrow.ts --network hedera_mainnet
 */
require("@nomicfoundation/hardhat-toolbox");

const OPERATOR_ID = process.env.HEDERA_OPERATOR_ID || "";
const OPERATOR_KEY = process.env.HEDERA_OPERATOR_KEY || "";

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    hedera_testnet: {
      url: "https://testnet.hashio.io",
      accounts: OPERATOR_KEY ? [OPERATOR_KEY] : [],
      chainId: 296,
      gas: 8000000,
      gasPrice: 0,
    },
    hedera_mainnet: {
      url: "https://mainnet.hashio.io",
      accounts: OPERATOR_KEY ? [OPERATOR_KEY] : [],
      chainId: 295,
      gas: 8000000,
      gasPrice: 0,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
