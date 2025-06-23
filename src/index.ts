import { ethers } from "hardhat";
import { RestClient } from "okx-api";
import "dotenv/config";
import {
  Pool,
  getPoolAddress,
  getUniswapV3PoolContract,
  getERC20TokenContract,
  getValidTick,
  TICK_SPACING,
  FeeAmount,
} from "./lib/common";
import { config } from "./config";
import { Wallet } from "ethers";
import { PositionManager } from "./lib/positionManager";
import { SwapRouter, ExactInputSingleParams } from "./exchange/dex/uniswapV3";
import { INonfungiblePositionManager } from "../typechain-types";

const okxClient = new RestClient(
  {
    apiKey: process.env.OKX_API_KEY!,
    apiSecret: process.env.OKX_API_SECRET!,
    apiPass: process.env.OKX_API_PASSPHRASE!,
  },
  "prod"
);

// 执行流程，以ETH/USDT为例
async function exec(wallet: Wallet, pool: Pool) {
  // 创建所需的实例（包括链上合约实例）
  // ERC20代币合约实例
  const wethContract = await getERC20TokenContract(pool.token0.address, wallet);
  const usdcContract = await getERC20TokenContract(pool.token1.address, wallet);
  // 创建uniswap v3 Pool合约实例
  const poolAddress = getPoolAddress(
    pool.token0.address,
    pool.token1.address,
    pool.fee
  );
  const uniswapV3PoolContract = await getUniswapV3PoolContract(poolAddress);
  // 创建positionManager合约实例
  const positionManager = await PositionManager.create(wallet);
  // 创建uniswap v3 swapRouter合约实例
  const swapRouter = await SwapRouter.create(wallet);
  // 向swapRouter合约授权WETH与USDC
  {
    // 检查allowance是否为MaxUint256，如果不是则需要授权
    const wethAllowance = await wethContract.allowance(
      wallet.address,
      swapRouter.swapRouterAddress
    );
    const usdcAllowance = await usdcContract.allowance(
      wallet.address,
      swapRouter.swapRouterAddress
    );
    if (wethAllowance < ethers.MaxUint256) {
      const wethApproval = await wethContract.approve(
        swapRouter.swapRouterAddress,
        ethers.MaxUint256
      );
      await wethApproval.wait(1);
    } else {
      console.log("WETH allowance is already MaxUint256, no need to approve.");
    }
    if (usdcAllowance < ethers.MaxUint256) {
      const usdcApproval = await usdcContract.approve(
        swapRouter.swapRouterAddress,
        ethers.MaxUint256
      );
      await usdcApproval.wait(1);
    } else {
      console.log("USDC allowance is already MaxUint256, no need to approve.");
    }
  }

  // 获取链上的ETH价格
  const slot0 = await uniswapV3PoolContract.slot0();
  const currentTick = slot0.tick;
  const currentPrice =
    Math.pow(1.0001, Number(currentTick)) *
    10 ** (pool.token0.decimals - pool.token1.decimals);
  console.log(
    `Current price of ${pool.token0.symbol}/${pool.token1.symbol} on-chain: ${currentPrice}`
  );
  // 获取钱包的WETH与USDC余额
  const wethBalance = await wethContract.balanceOf(wallet.address);
  const usdcBalance = await usdcContract.balanceOf(wallet.address);
  const wethBalanceValue =
    Number(ethers.formatUnits(wethBalance, pool.token0.decimals)) *
    currentPrice;
  const usdcBalanceValue = Number(
    ethers.formatUnits(usdcBalance, pool.token1.decimals)
  );
  console.log(
    `Wallet WETH balance: ${ethers.formatUnits(
      wethBalance,
      pool.token0.decimals
    )}, value: ${wethBalanceValue} USDC`
  );
  console.log(
    `Wallet USDC balance: ${ethers.formatUnits(
      usdcBalance,
      pool.token1.decimals
    )}, value: ${usdcBalanceValue} USDC`
  );
  // 计算兑换比率，假设要使得usdc与weth的价值相等
  // 为了避免多余的weth未被兑换成usdc以带来多余的风险暴露，这里我们将usdc：weth的价值比设为1:0.98
  const totalValue = wethBalanceValue + usdcBalanceValue;
  const targetWethValue = (totalValue * 0.98) / 1.98;
  const targetUsdcValue = totalValue - targetWethValue;
  let swapParams: ExactInputSingleParams | undefined = undefined;
  if (targetWethValue < wethBalanceValue) {
    // 如果目标WETH价值小于当前WETH价值，则需要将多余的WETH兑换成USDC
    const swapWethAmount = (wethBalanceValue - targetWethValue) / currentPrice;
    const amountIn = ethers.parseUnits(
      swapWethAmount.toFixed(6),
      pool.token0.decimals
    );
    if (amountIn > 0n) {
      swapParams = {
        tokenIn: pool.token0.address,
        tokenOut: pool.token1.address,
        fee: FeeAmount.LOW, // 使用低费率池进行兑换
        recipient: wallet.address,
        amountIn,
        amountOutMinimum: 0, // 最小输出量为0，实际应用中应设置合理值
        sqrtPriceLimitX96: 0, // 不限制价格
      };
    }
  } else if (targetUsdcValue < usdcBalanceValue) {
    // 如果目标USDC价值小于当前USDC价值，则需要将多余的USDC兑换成WETH
    const swapUsdcAmount = usdcBalanceValue - targetUsdcValue;
    const amountIn = ethers.parseUnits(
      swapUsdcAmount.toFixed(6),
      pool.token1.decimals
    );
    if (amountIn > 0n) {
      swapParams = {
        tokenIn: pool.token1.address,
        tokenOut: pool.token0.address,
        fee: pool.fee,
        recipient: wallet.address,
        amountIn,
        amountOutMinimum: 0, // 最小输出量为0，实际应用中应设置合理值
        sqrtPriceLimitX96: 0, // 不限制价格
      };
    }
  }
  if (swapParams) {
    const receipt = await swapRouter.exactInputSingle(swapParams);
    // console.log(`receipt: ${JSON.stringify(receipt, null, 2)}`);
  }
  // 查看钱包的WETH与USDC余额
  const newWethBalance = await wethContract.balanceOf(wallet.address);
  const newUsdcBalance = await usdcContract.balanceOf(wallet.address);
  const newWethBalanceValue =
    Number(ethers.formatUnits(newWethBalance, pool.token0.decimals)) *
    currentPrice;
  const newUsdcBalanceValue = Number(
    ethers.formatUnits(newUsdcBalance, pool.token1.decimals)
  );
  console.log(
    `New wallet WETH balance: ${ethers.formatUnits(
      newWethBalance,
      pool.token0.decimals
    )}, value: ${newWethBalanceValue} USDC`
  );
  console.log(
    `New wallet USDC balance: ${ethers.formatUnits(
      newUsdcBalance,
      pool.token1.decimals
    )}, value: ${newUsdcBalanceValue} USDC`
  );
  // 使用okx合约对冲weth数量，开3倍杠杆
  const newWethAmountReadable = Number(
    ethers.formatUnits(newWethBalance, pool.token0.decimals)
  );
  // 市价单, 开3倍杠杆
  await okxClient.setLeverage({
    instId: "ETH-USDT-SWAP",
    lever: "3",
    mgnMode: "cross",
  });
  await okxClient.submitOrder({
    instId: "ETH-USDT-SWAP",
    side: "sell",
    ordType: "market",
    sz: (10 * newWethAmountReadable).toFixed(2),
    tdMode: "cross",
    posSide: "net",
  });
  // 以当前tick上下150个tick为界，提供流动性
  let mintPositionParams: INonfungiblePositionManager.MintParamsStruct = {
    token0: pool.token0.address,
    token1: pool.token1.address,
    fee: pool.fee,
    tickLower: getValidTick(Number(currentTick - 150n), TICK_SPACING[pool.fee]),
    tickUpper: getValidTick(Number(currentTick + 150n), TICK_SPACING[pool.fee]),
    amount0Desired: newWethBalance,
    amount1Desired: newUsdcBalance,
    amount0Min: 0,
    amount1Min: 0,
    recipient: wallet.address,
    deadline: Math.floor(Date.now() / 1000) + 60 * 20,
  };
  const tokenId = await positionManager.mintPosition(mintPositionParams);
  console.log("Minted position with token ID:", tokenId);
  // 查看钱包的流动性头寸
  const position = await positionManager.getPosition(tokenId);
  console.log("Position details:", position);
  // 获取weth与usdc的余额
  const finalWethBalance = await wethContract.balanceOf(wallet.address);
  const finalUsdcBalance = await usdcContract.balanceOf(wallet.address);
  console.log(
    `Final WETH balance: ${ethers.formatUnits(
      finalWethBalance,
      pool.token0.decimals
    )}`
  );
  console.log(
    `Final USDC balance: ${ethers.formatUnits(
      finalUsdcBalance,
      pool.token1.decimals
    )}`
  );
}

async function main() {
  const pool = config.pools[1];
  const wallet = new Wallet(process.env.PRIVATE_KEY!, ethers.provider);
  // 如果是localhost网络，则mine a block并且发送一点ETH
  if (process.env.HARDHAT_NETWORK === "localhost") {
    await ethers.provider.send("evm_mine", []);
    await ethers.provider.send("hardhat_setBalance", [
      wallet.address,
      `0x${ethers.parseEther("100").toString(16)}`,
    ]);
  }
  await exec(wallet, pool);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
