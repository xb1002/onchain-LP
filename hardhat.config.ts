import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const config: HardhatUserConfig = {
  solidity: "0.8.28",
  defaultNetwork: "base",
  networks: {
    hardhat: {
      forking: {
        url: process.env.RPC_URL || "https://mainnet.base.org", // 你的 RPC
      },
      chainId: 8453,
      gasPrice: "auto",
    },
    base: {
      url: process.env.RPC_URL || "https://mainnet.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 8453,
      gasPrice: "auto",
    },
  },
};

export default config;
