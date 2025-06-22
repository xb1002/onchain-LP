import { ethers } from "hardhat";
import { IERC20, IUniswapV3Pool } from "../../typechain-types";
import { Wallet } from "ethers";

enum FeeAmount {
  LOW = 500, // 0.05%
  MEDIUM = 3000, // 0.3%
  HIGH = 10000, // 1%
}
enum TickSpacing {
  LOW = 10, // 0.05%
  MEDIUM = 60, // 0.3%
  HIGH = 200, // 1%
}
const TICK_SPACING: Record<FeeAmount, TickSpacing> = {
  [FeeAmount.LOW]: TickSpacing.LOW,
  [FeeAmount.MEDIUM]: TickSpacing.MEDIUM,
  [FeeAmount.HIGH]: TickSpacing.HIGH,
};

interface Token {
  address: string;
  symbol: string;
  decimals: number;
}

class Pool {
  token0: Token;
  token1: Token;
  fee: FeeAmount;
  constructor(token0: Token, token1: Token, fee: FeeAmount) {
    [this.token0, this.token1] =
      token0.address < token1.address ? [token0, token1] : [token1, token0];
    this.fee = fee;
  }
  static create(token0: Token, token1: Token, fee: FeeAmount): Pool {
    return new Pool(token0, token1, fee);
  }
}

async function getERC20TokenContract(
  address: string,
  wallet?: Wallet
): Promise<IERC20> {
  const contract = await ethers.getContractAt("IERC20", address, wallet);
  return contract as IERC20;
}

async function getUniswapV3PoolContract(
  poolAddress: string
): Promise<IUniswapV3Pool> {
  const contract = await ethers.getContractAt("IUniswapV3Pool", poolAddress);
  return contract as IUniswapV3Pool;
}

function getPoolAddress(
  tokenA: string, // 代币A地址
  tokenB: string, // 代币B地址
  fee: FeeAmount,
  overrideFactoryAddress?: string,
  overrideInitCodeHash?: string
): string {
  // 默认的factory地址与init_code_hash
  const factoryAddress =
    overrideFactoryAddress || "0x33128a8fC17869897dcE68Ed026d694621f6FDfD"; // 这是base上的地址
  const initCodeHash =
    overrideInitCodeHash ||
    "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";

  // 对tokenA和tokenB进行排序，确保地址顺序一致
  const [token0, token1] =
    tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];

  // 使用 ethers.js 的 keccak256 和 abi.encodePacked 方法计算池地址
  const poolAddress = ethers.getCreate2Address(
    factoryAddress,
    ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24"],
        [token0, token1, fee]
      )
    ),
    initCodeHash
  );

  return poolAddress;
}

function getValidTick(tick: number, tickSpacing: TickSpacing): number {
  // 确保tick是tickSpacing的倍数
  tick = Math.floor(tick / tickSpacing) * tickSpacing;
  // 返回有效的tick值
  return tick;
}

function getTickBySqrtPriceX96(SqrtPriceX96: number): number {
  const sqrtPrice = SqrtPriceX96 / 2 ** 96; // 将SqrtPriceX96转换为平方根价格
  // 将平方根价格转换为tick值
  const tick = Math.log(sqrtPrice ** 2) / Math.log(1.0001);
  return Math.floor(tick);
}

function getSqrtPriceByTick(tick: number): number {
  // 将tick值转换为平方根价格
  const sqrtPrice = 1.0001 ** (tick / 2);
  return sqrtPrice;
}

function calculateLiquidity(
  currentSqrtPriceX96: number,
  tickLower: number,
  tickUpper: number,
  amount0: number,
  amount1: number,
  tickSpacing: TickSpacing
): number {
  // 确保tickLower和tickUpper是有效的
  if (tickLower >= tickUpper) {
    throw new Error("tickLower must be less than tickUpper");
  }
  if (tickLower % tickSpacing !== 0 || tickUpper % tickSpacing !== 0) {
    throw new Error(
      "Invalid tickLower or tickUpper, must be multiples of tickSpacing"
    );
  }
  // 计算流动性
  const currentSqrtPrice = currentSqrtPriceX96 / 2 ** 96;
  const sqrtPriceLower = getSqrtPriceByTick(tickLower);
  const sqrtPriceUpper = getSqrtPriceByTick(tickUpper);
  let liquidity: number;
  if (currentSqrtPrice < sqrtPriceLower) {
    // 价格在下限以下，可以理解为挂一个高价卖出，代币全部是代币0
    liquidity =
      (amount0 * sqrtPriceUpper * sqrtPriceLower) /
      (sqrtPriceUpper - sqrtPriceLower);
  } else if (currentSqrtPrice > sqrtPriceUpper) {
    liquidity = amount1 / (sqrtPriceUpper - sqrtPriceLower);
  } else {
    let L0 =
      (amount0 * sqrtPriceUpper * currentSqrtPrice) /
      (sqrtPriceUpper - currentSqrtPrice);
    let L1 = amount1 / (currentSqrtPrice - sqrtPriceLower);
    liquidity = Math.min(L0, L1);
  }
  return Math.floor(liquidity);
}

function calculateAmount0ByLiquidity(
  liquidity: number,
  currentSqrtPriceX96: number,
  tickLower: number,
  tickUpper: number
): number {
  // 计算平方根价格
  const sqrtPriceLower = getSqrtPriceByTick(tickLower);
  const sqrtPriceUpper = getSqrtPriceByTick(tickUpper);
  const currentSqrtPrice = currentSqrtPriceX96 / 2 ** 96;
  // 计算代币0的数量
  let amount0: number;
  if (currentSqrtPrice < sqrtPriceLower) {
    // 价格在下限以下，全部是代币0
    amount0 =
      (liquidity * (sqrtPriceUpper - sqrtPriceLower)) /
      (sqrtPriceLower * sqrtPriceUpper);
  } else if (currentSqrtPrice > sqrtPriceUpper) {
    // 价格在上限以上，代币0数量为0
    amount0 = 0;
  } else {
    // 在tick范围内，计算代币0的数量
    amount0 =
      (liquidity * (sqrtPriceUpper - currentSqrtPrice)) /
      (currentSqrtPrice * sqrtPriceUpper);
  }
  return Math.floor(amount0);
}

function calculateAmount1ByLiquidity(
  liquidity: number,
  currentSqrtPriceX96: number,
  tickLower: number,
  tickUpper: number
): number {
  // 计算平方根价格
  const sqrtPriceLower = getSqrtPriceByTick(tickLower);
  const sqrtPriceUpper = getSqrtPriceByTick(tickUpper);
  const currentSqrtPrice = currentSqrtPriceX96 / 2 ** 96;
  // 计算代币1的数量
  let amount1: number;
  if (currentSqrtPrice < sqrtPriceLower) {
    // 价格在下限以下，代币1数量为0
    amount1 = 0;
  } else if (currentSqrtPrice > sqrtPriceUpper) {
    // 价格在上限以上，全部是代币1
    amount1 = liquidity * (sqrtPriceUpper - sqrtPriceLower);
  } else {
    // 在tick范围内，计算代币1的数量
    amount1 = liquidity * (currentSqrtPrice - sqrtPriceLower);
  }
  return Math.floor(amount1);
}

function adjustPrice(price: number, token0: Token, token1: Token): number {
  const adjustedPrice = price * 10 ** (token1.decimals - token0.decimals);
  return adjustedPrice;
}

async function test() {
  const price = 2500 / 1e12;
  const sqrtPriceX96 = price ** 0.5 * 2 ** 96;
  const tick = getTickBySqrtPriceX96(sqrtPriceX96);
  const validTick = getValidTick(tick, TickSpacing.LOW);
  const tickLower = validTick - 200;
  const tickUpper = validTick + 200;
  const liquidity = calculateLiquidity(
    sqrtPriceX96,
    tickLower,
    tickUpper,
    1 * 1e18,
    2500 * 1e6,
    TickSpacing.LOW
  );
  console.log("Calculated liquidity:", liquidity);

  const amount0 = calculateAmount0ByLiquidity(
    liquidity,
    sqrtPriceX96,
    tickLower,
    tickUpper
  );
  console.log("Calculated amount0:", amount0);

  const amount1 = calculateAmount1ByLiquidity(
    liquidity,
    sqrtPriceX96,
    tickLower,
    tickUpper
  );
  console.log("Calculated amount1:", amount1);
}

// test()
//   .then(() => console.log("Common module loaded successfully"))
//   .catch((error) => console.error("Error loading common module:", error));

export {
  FeeAmount,
  Token,
  Pool,
  TickSpacing,
  TICK_SPACING,
  getERC20TokenContract,
  getUniswapV3PoolContract,
  getPoolAddress,
  getValidTick,
  getTickBySqrtPriceX96,
  getSqrtPriceByTick,
  calculateLiquidity,
  calculateAmount0ByLiquidity,
  calculateAmount1ByLiquidity,
  adjustPrice,
};
