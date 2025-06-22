import { Token, FeeAmount, Pool } from "./lib/common";

const fee: FeeAmount = 500; // 0.05% 的手续费
const tokenA: Token = {
  address: "0x4200000000000000000000000000000000000006", // 示例地址
  symbol: "WETH",
  decimals: 18,
};
const tokenB: Token = {
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // 示例地址
  symbol: "USDC",
  decimals: 6,
};

const pool: Pool =
  tokenA.address < tokenB.address
    ? { token0: tokenA, token1: tokenB, fee }
    : { token0: tokenB, token1: tokenA, fee };

const uniswapV3 = {
  swapRouterAddress: "0x2626664c2603336E57B271c5C0b26F421741e481", // Uniswap V3 Swap Router 地址
};
export const config = {
  pool,
  uniswapV3,
};
