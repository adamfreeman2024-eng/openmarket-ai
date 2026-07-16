// Hardhat skeleton — install hardhat when ready to deploy:
// npm i -D hardhat @nomicfoundation/hardhat-toolbox
// npx hardhat compile
//
// Hedera EVM networks: https://docs.hedera.com/hedera/core-concepts/smart-contracts

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.20",
  paths: {
    sources: "./contracts",
    artifacts: "./artifacts",
  },
  networks: {
    // hederaTestnet: {
    //   url: process.env.HEDERA_JSON_RPC_RELAY,
    //   accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    // },
  },
};
