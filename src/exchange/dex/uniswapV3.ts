import { ethers, network } from "hardhat";
import { ISwapRouter } from "../../../typechain-types";
import { Wallet, TransactionReceipt } from "ethers";
import { getERC20TokenContract } from "../../lib/common";
import { config } from "../../config";
import "dotenv/config";

interface ExactInputSingleParams
  extends ISwapRouter.ExactInputSingleParamsStruct {}

class SwapRouter {
  public swapRouterAddress: string;
  public swapRouterContract: ISwapRouter | undefined;
  public wallet: Wallet;

  constructor(wallet: Wallet, swapRouterAddress?: string) {
    this.wallet = wallet;
    this.swapRouterAddress =
      swapRouterAddress || config.uniswapV3.swapRouterAddress;
  }

  static async create(wallet: Wallet): Promise<SwapRouter> {
    const swapRouter = new SwapRouter(wallet);
    await swapRouter.initialize();
    return swapRouter;
  }

  async initialize(): Promise<void> {
    this.swapRouterContract = await ethers.getContractAt(
      "ISwapRouter",
      this.swapRouterAddress,
      this.wallet
    );
  }

  // @dev 注意，调用前需要对SwapRouter合约授权需要交换的代币数量
  async exactInputSingle(
    params: ExactInputSingleParams
  ): Promise<TransactionReceipt> {
    const tx = await this.swapRouterContract!.exactInputSingle(params);
    const receipt = await tx.wait();
    return receipt!;
  }
}

async function test() {
  // mine a block to ensure the latest block is used
  await network.provider.send("evm_mine", []);
  const wallet = new ethers.Wallet(
    process.env.PRIVATE_KEY || "",
    ethers.provider
  );
  //   发送资金
  await network.provider.send("hardhat_setBalance", [
    wallet.address,
    `0x${ethers.parseEther("100").toString(16)}`,
  ]);
  const swapRouter = await SwapRouter.create(wallet);
  //   向swapRouter授权token0
  const token0Contract = await getERC20TokenContract(
    config.pool.token0.address,
    wallet
  );
  const token1Contract = await getERC20TokenContract(
    config.pool.token1.address,
    wallet
  );
  //   查看当前余额
  const balanceToken0 = await token0Contract.balanceOf(wallet.address);
  const balanceToken1 = await token1Contract.balanceOf(wallet.address);
  console.log("Balance of token0:", balanceToken0.toString());
  console.log("Balance of token1:", balanceToken1.toString());
  //   授权swapRouter合约使用token0和token1
  const approveToken0Tx = await token0Contract.approve(
    swapRouter.swapRouterAddress,
    ethers.MaxUint256
  );
  const approveToken1Tx = await token1Contract.approve(
    swapRouter.swapRouterAddress,
    ethers.MaxUint256
  );
  await approveToken0Tx.wait();
  await approveToken1Tx.wait();
  console.log("Token approvals completed");
  //   查看allowance
  const allowanceToken0 = await token0Contract.allowance(
    wallet.address,
    swapRouter.swapRouterAddress
  );
  const allowanceToken1 = await token1Contract.allowance(
    wallet.address,
    swapRouter.swapRouterAddress
  );
  console.log("Allowance for token0:", allowanceToken0.toString());
  console.log("Allowance for token1:", allowanceToken1.toString());
  //   进行兑换
  const params: ExactInputSingleParams = {
    tokenIn: config.pool.token0.address,
    tokenOut: config.pool.token1.address,
    fee: config.pool.fee,
    recipient: wallet.address,
    amountIn: balanceToken0, // 使用token0的全部余额进行兑换
    amountOutMinimum: 0, // 最小输出量设置为0，实际应用中应根据需求设置
    sqrtPriceLimitX96: 0, // 不限制价格
  };
  const receipt = await swapRouter.exactInputSingle(params);
  // console.log("receipt:", receipt);

  //  查看兑换后的余额
  const newBalanceToken0 = await token0Contract.balanceOf(wallet.address);
  const newBalanceToken1 = await token1Contract.balanceOf(wallet.address);
  console.log("New balance of token0:", newBalanceToken0.toString());
  console.log("New balance of token1:", newBalanceToken1.toString());
}

// test()
//   .then(() => {
//     console.log("Test completed");
//   })
//   .catch((error) => {
//     console.error("Test failed:", error);
//   });
export { SwapRouter, ExactInputSingleParams };
