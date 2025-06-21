import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.28",
  defaultNetwork: "base",
  networks: {
    hardhat: {
      forking: {
        url: "https://mainnet.base.org", // 你的 RPC
      },
      chainId: 8453,
    },
    base: {
      url: "https://mainnet.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 8453,
    },
  },
};

export default config;
