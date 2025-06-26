import { ethers } from "hardhat";
import { Wallet, TransactionReceipt } from "ethers";
import { INonfungiblePositionManager } from "../../typechain-types";
import "dotenv/config";
import { FeeAmount, getERC20TokenContract, getPoolAddress } from "./common";

const INonfungiblePositionManagerAddress =
  "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1"; // base链上的 Uniswap V3 Position Manager 地址
const Uint128Max = 340282366920938463463374607431768211455n;

interface PositionResponse {
  nonce: bigint;
  operator: string;
  token0: string;
  token1: string;
  fee: bigint;
  tickLower: bigint;
  tickUpper: bigint;
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

//   注意这个需要使用create方法创建合约实例
class PositionManager {
  // 参数
  // wallet
  public wallet: Wallet | undefined;
  // Uniswap V3 Position Manager 合约地址
  public nonfungiblePositionManagerAddress: string;
  // uniswap v3 position manager 合约实例
  public nonfungiblePositionManager: INonfungiblePositionManager | undefined;
  //   NFT Index map 地址的index-> NFT ID
  public nftIndexIdsMap: Map<number, bigint> = new Map();
  constructor(wallet: Wallet, nonfungiblePositionManagerAddress?: string) {
    this.wallet = wallet;
    this.nonfungiblePositionManagerAddress =
      nonfungiblePositionManagerAddress || INonfungiblePositionManagerAddress;
  }

  public static async create(
    wallet: Wallet,
    nonfungiblePositionManagerAddress?: string
  ): Promise<PositionManager> {
    const positionManager = new PositionManager(
      wallet,
      nonfungiblePositionManagerAddress
    );
    await positionManager.initialize();
    return positionManager;
  }

  private async initialize() {
    this.nonfungiblePositionManager = await this.getPositionManager();
  }

  public async getPositionManager(): Promise<INonfungiblePositionManager> {
    if (!this.wallet) {
      throw new Error("Wallet is not initialized.");
    }
    return (await ethers.getContractAt(
      "INonfungiblePositionManager",
      this.nonfungiblePositionManagerAddress,
      this.wallet
    )) as INonfungiblePositionManager;
  }

  public async checkIds(): Promise<bigint[]> {
    // Check the NFT IDs
    const ids: bigint[] = [];
    const nftNum = await this.nonfungiblePositionManager?.balanceOf(
      this.wallet!.address
    );
    // 如果没有NFT，则返回空数组
    if (Number(nftNum!) === 0) {
      return ids;
    }
    for (let i = this.nftIndexIdsMap.size; i < nftNum!; i++) {
      const id = await this.nonfungiblePositionManager!.tokenOfOwnerByIndex(
        this.wallet!.address,
        i
      );
      ids.push(id);
      this.nftIndexIdsMap.set(i, id);
    }
    return ids;
  }

  public async getPosition(tokenId: bigint): Promise<PositionResponse> {
    if (!this.nonfungiblePositionManager) {
      throw new Error("Position Manager is not initialized.");
    }
    const position = await this.nonfungiblePositionManager.positions(tokenId);
    return position;
  }

  public async mintPosition(
    params: INonfungiblePositionManager.MintParamsStruct
  ): Promise<bigint> {
    const { tokenId } = await this.nonfungiblePositionManager!.mint.staticCall(
      params
    );
    const tx = await this.nonfungiblePositionManager!.mint(params);
    const receipt = await tx.wait(1);
    if (receipt!.status !== 1) {
      throw new Error("Minting position failed.");
    } else {
      return tokenId;
    }
  }

  public async removeLiquidity(
    params: INonfungiblePositionManager.DecreaseLiquidityParamsStruct
  ): Promise<TransactionReceipt> {
    const tx = await this.nonfungiblePositionManager!.decreaseLiquidity(params);
    const receipt = await tx.wait(1);
    return receipt!;
  }

  public async collect(
    params: INonfungiblePositionManager.CollectParamsStruct
  ): Promise<TransactionReceipt> {
    const tx = await this.nonfungiblePositionManager!.collect(params);
    const receipt = await tx.wait(1);
    return receipt!;
  }

  public async burnPosition(tokenId: bigint): Promise<TransactionReceipt> {
    const tx = await this.nonfungiblePositionManager!.burn(tokenId);
    const receipt = await tx.wait(1);
    return receipt!;
  }

  public async checkActivated(
    tokenId: bigint
  ): Promise<[activate: boolean, position: PositionResponse]> {
    if (!this.nonfungiblePositionManager) {
      throw new Error("Position Manager is not initialized.");
    }
    const position = await this.nonfungiblePositionManager.positions(tokenId);
    const { token0, token1, fee, tickLower, tickUpper } = position;
    const uniswapV3PoolContract = await ethers.getContractAt(
      "IUniswapV3Pool",
      getPoolAddress(token0, token1, Number(fee))
    );
    const slot0 = await uniswapV3PoolContract.slot0();
    console.log(
      `positionId: ${tokenId} Current tick: ${slot0.tick}, Lower tick: ${tickLower}, Upper tick: ${tickUpper}`
    );
    return [slot0.tick >= tickLower && slot0.tick <= tickUpper, position];
  }

  public async closeAllPositions(): Promise<TransactionReceipt[]> {
    const ids = await this.checkIds();
    const receipts: TransactionReceipt[] = [];
    for (const id of ids) {
      const position = await this.getPosition(id);
      if (position.liquidity > 0) {
        // Remove liquidity
        const decreaseLiquidityParams: INonfungiblePositionManager.DecreaseLiquidityParamsStruct =
          {
            tokenId: id,
            liquidity: position.liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: Math.floor(Date.now() / 1000) + 60 * 10, // 10 minutes from now
          };
        const removeReceipt = await this.removeLiquidity(
          decreaseLiquidityParams
        );
        receipts.push(removeReceipt);
        // Collect fees
        const collectReceipt = await this.collect({
          tokenId: id,
          recipient: this.wallet!.address,
          amount0Max: Uint128Max,
          amount1Max: Uint128Max,
        });
        receipts.push(collectReceipt);
      }
      // Burn position
      const burnReceipt = await this.burnPosition(id);
      receipts.push(burnReceipt);
    }
    return receipts;
  }
}

async function test() {
  // mine a block
  // await ethers.provider.send("evm_mine", []);
  const wallet = new Wallet(process.env.PRIVATE_KEY!, ethers.provider);
  const positionManager = await PositionManager.create(wallet);
  const weth = await getERC20TokenContract(
    "0x4200000000000000000000000000000000000006"
  );
  const usdc = await getERC20TokenContract(
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
  );
  // 查看weth和usdc的余额
  const wethBalance = await weth.balanceOf(wallet.address);
  const usdcBalance = await usdc.balanceOf(wallet.address);
  console.log("WETH balance:", wethBalance);
  console.log("USDC balance:", usdcBalance);

  // 检查tokenId
  const ids = await positionManager.checkIds();
  const tokenId = ids[0];
  // 查看position
  const position = await positionManager.getPosition(tokenId);
  console.log("Position details:", position);
  // 收取流动性费用
  // const collectParams: INonfungiblePositionManager.CollectParamsStruct = {
  //   tokenId,
  //   recipient: wallet.address,
  //   amount0Max: Uint128Max,
  //   amount1Max: Uint128Max,
  // };
  // const collectReceipt = await positionManager.collect(collectParams);
  // console.log("Collect receipt:", collectReceipt);

  // 查看weth和usdc的余额
  const newWethBalance = await weth.balanceOf(wallet.address);
  const newUsdcBalance = await usdc.balanceOf(wallet.address);
  console.log("New WETH balance:", newWethBalance);
  console.log("New USDC balance:", newUsdcBalance);

  //   remove liquidity
  const decreaseLiquidityParams: INonfungiblePositionManager.DecreaseLiquidityParamsStruct =
    {
      tokenId,
      liquidity: position.liquidity,
      amount0Min: 0,
      amount1Min: 0,
      deadline: Math.floor(Date.now() / 1000) + 60 * 10, // 10 minutes from now
    };
  const removeReceipt = await positionManager.removeLiquidity(
    decreaseLiquidityParams
  );
  // 再次收取流动性费用
  const collectReceiptAfterRemoval = await positionManager.collect({
    tokenId,
    recipient: wallet.address,
    amount0Max: Uint128Max,
    amount1Max: Uint128Max,
  });
  // 查看position
  const newPosition = await positionManager.getPosition(tokenId);
  console.log("New Position details after removal:", newPosition);

  // 查看weth和usdc的余额
  const finalWethBalance = await weth.balanceOf(wallet.address);
  const finalUsdcBalance = await usdc.balanceOf(wallet.address);
  console.log("Final WETH balance:", finalWethBalance);
  console.log("Final USDC balance:", finalUsdcBalance);
}

// test()
//   .then(() => console.log("Test completed successfully."))
//   .catch((error) => console.error("Error during test:", error));

async function testCloseAllPositions() {
  const wallet = new Wallet(process.env.PRIVATE_KEY!, ethers.provider);
  const positionManager = await PositionManager.create(wallet);
  const receipts = await positionManager.closeAllPositions();
  console.log("Close all positions receipts:", receipts);
}
// testCloseAllPositions()
//   .then(() => console.log("Close all positions test completed successfully."))
//   .catch((error) =>
//     console.error("Error during close all positions test:", error)
//   );

export { PositionManager, PositionResponse, Uint128Max };
