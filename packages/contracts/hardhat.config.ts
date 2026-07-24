import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";
import type { HardhatUserConfig } from "hardhat/config";

const key = process.env.DEPLOYER_PRIVATE_KEY;
const config: HardhatUserConfig = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 500 }, viaIR: true } },
  networks: {
    onyx: {
      url: process.env.ONYX_RPC_URL || "https://rpc.onyx.org",
      chainId: 327,
      accounts: key ? [key] : [],
    },
    hardhat: process.env.ONYX_FORK === "true" ? {
      chainId: 327,
      forking: { url: process.env.ONYX_RPC_URL || "https://rpc.onyx.org" }
    } : { chainId: 31337 }
  },
  mocha: { timeout: 120_000 }
};
export default config;
