import { getUniswapV3PoolContract } from "./common";
import { ethers } from "hardhat";

async function getBlockNumberByTimestamp(
  timestamp: number,
  averageBlockTime: number = 2 * 1000 //平均出块时间，单位为毫秒
): Promise<number> {
  // 获取当前区块的number与timestamp
  const currentBlock = await ethers.provider.getBlock("latest");
  if (!currentBlock) {
    throw new Error("Failed to fetch the latest block");
  }
  const currentBlockNumber = currentBlock.number;
  const currentTimestamp = currentBlock.timestamp;
  // 计算目标区块的number
  const targetBlockNumber = Math.floor(
    currentBlockNumber - (currentTimestamp - timestamp) / averageBlockTime
  );
  // 确保目标区块号不小于0
  if (targetBlockNumber < 0) {
    throw new Error("Calculated block number is less than 0");
  }
  return targetBlockNumber;
}

async function getHistoricalFeeGrowth(params: {
  poolAddress: string;
  blockNum: number;
}): Promise<{ feeGrowthGlobal0X128: string; feeGrowthGlobal1X128: string }> {
  const { poolAddress, blockNum } = params;

  try {
    const poolContract = await getUniswapV3PoolContract(poolAddress);
    const [feeGrowthGlobal0X128, feeGrowthGlobal1X128] = await Promise.all([
      poolContract.feeGrowthGlobal0X128({ blockTag: blockNum }),
      poolContract.feeGrowthGlobal1X128({ blockTag: blockNum }),
    ]);
    return {
      feeGrowthGlobal0X128: feeGrowthGlobal0X128.toString(),
      feeGrowthGlobal1X128: feeGrowthGlobal1X128.toString(),
    };
  } catch (error) {
    console.error("Error fetching historical fee growth:", error);
  }
  return {
    feeGrowthGlobal0X128: "0",
    feeGrowthGlobal1X128: "0",
  };
}

async function test() {
  const poolAddress = "0x6c561B446416E1A00E8E93E221854d6eA4171372"; // Replace with actual pool address
  // 获取30天前的blockNumber
  const timestamp = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60; // 30天前的时间戳
  const averageBlockTime = 2 * 1000; // 平均出块时间
  const blockNum = await getBlockNumberByTimestamp(timestamp, averageBlockTime);

  const result = await getHistoricalFeeGrowth({ poolAddress, blockNum });
  console.log("Historical Fee Growth:", result);
}

if (require.main === module) {
  test().catch(console.error);
}

export { getHistoricalFeeGrowth };
