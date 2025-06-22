import {
  Pool,
  getPoolAddress,
  getUniswapV3PoolContract,
  calculateLiquidity,
} from "./lib/common";
import { config } from "./config";
import fs from "fs";
import readline from "readline";
import { ethers } from "hardhat";

const defaultDataSaveDir = "./data/feeGrowthGlobal"; // 这里不要在最后加斜杠

interface record {
  timeStamp: string;
  feeGrowthGlobal0X128: string;
  feeGrowthGlobal1X128: string;
}

async function getFeeGrowthGlobal(
  pool: Pool,
  save: boolean = false,
  saveDir: string = defaultDataSaveDir
): Promise<{
  feeGrowthGlobal0X128: bigint;
  feeGrowthGlobal1X128: bigint;
}> {
  const poolAddress = getPoolAddress(
    pool.token0.address,
    pool.token1.address,
    pool.fee
  );
  const poolContract = await getUniswapV3PoolContract(poolAddress);
  const feeGrowthGlobal0X128 = await poolContract.feeGrowthGlobal0X128();
  const feeGrowthGlobal1X128 = await poolContract.feeGrowthGlobal1X128();
  if (save) {
    const record = JSON.stringify({
      timeStamp: new Date().toISOString(),
      feeGrowthGlobal0X128: feeGrowthGlobal0X128.toString(),
      feeGrowthGlobal1X128: feeGrowthGlobal1X128.toString(),
    });
    const saveFile = `${saveDir}/${pool.token0.symbol}_${pool.token1.symbol}_${pool.fee}.jsonl`;
    fs.writeFileSync(saveFile, record + "\n", {
      flag: "a+",
    });
  }
  return { feeGrowthGlobal0X128, feeGrowthGlobal1X128 };
}

async function fetchFeeGrowthGlobal(pool: Pool, interval: number) {
  while (true) {
    try {
      const feeGrowth = await getFeeGrowthGlobal(pool, true);
      console.log("Fee Growth Global:", feeGrowth);
    } catch (error) {
      console.error("Error fetching fee growth global:", error);
    } finally {
      // 等待指定的时间间隔后再次获取数据
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}

async function readFeeGrowthGlobal(
  pool: Pool,
  saveDir: string = defaultDataSaveDir
): Promise<record[]> {
  const filePath = `${saveDir}/${pool.token0.symbol}_${pool.token1.symbol}_${pool.fee}.jsonl`;
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  // 读取文件内容并解析为对象数组
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return [];
  }
  const records: record[] = [];
  for await (const line of rl) {
    if (line.trim()) {
      const record = JSON.parse(line);
      records.push(record);
    }
  }
  return records;
}

// 分析数据
async function estimateFeeEarnedPerLiquidity(
  records: record[],
  timeInterval: number // 时间间隔，单位为毫秒
): Promise<{
  fee0Annualized: number;
  fee1Annualized: number;
}> {
  // 根据最近最近的一段时间（interval）内的feeGrowthGlobal数据来估算每个流动性单位的费用，年化这部分费用
  //   使用二分法寻找合适的records
  const latestRecord = records[records.length - 1];
  const previousRecord: record | undefined = records.reverse().find((rec) => {
    const endTime = new Date(latestRecord.timeStamp).getTime();
    const startTime = endTime - timeInterval;
    return new Date(rec.timeStamp).getTime() <= startTime;
  });
  console.log(`from ${previousRecord?.timeStamp} to ${latestRecord.timeStamp}`);
  if (!previousRecord) {
    throw new Error("Previous record not found.");
  }
  const fee0 =
    (Number(latestRecord.feeGrowthGlobal0X128) -
      Number(previousRecord.feeGrowthGlobal0X128)) /
    2 ** 128;
  const fee1 =
    (Number(latestRecord.feeGrowthGlobal1X128) -
      Number(previousRecord.feeGrowthGlobal1X128)) /
    2 ** 128;
  const actualTimeInterval =
    new Date(latestRecord.timeStamp).getTime() -
    new Date(previousRecord.timeStamp).getTime();
  const fee0Annualized =
    (fee0 / actualTimeInterval) * 365 * 24 * 60 * 60 * 1000;
  const fee1Annualized =
    (fee1 / actualTimeInterval) * 365 * 24 * 60 * 60 * 1000;
  return { fee0Annualized, fee1Annualized };
}

async function main() {
  const pools: Pool[] = config.pools;
  // 如何网络是localhost，则挖掘一个区块
  const network = await ethers.provider.getNetwork();
  if (network.name === "localhost") {
    await ethers.provider.send("evm_mine", []);
  }
  // 程序1
  // 获取数据
  let program1Task: Promise<void>[] = [];
  const interval = 30 * 60 * 1000; // 每30分钟获取一次
  for (const pool of pools) {
    program1Task.push(fetchFeeGrowthGlobal(pool, interval));
  }
  await Promise.all(program1Task);
  //   程序2
  // 解析数据
  // const pool = pools[0]; // 只解析第一个池子
  // const records = await readFeeGrowthGlobal(pool);
  // const timeInterval = 1 * 60 * 60 * 1000; // 24小时
  // const { fee0Annualized, fee1Annualized } =
  //   await estimateFeeEarnedPerLiquidity(records, timeInterval);
  // console.log("Estimated Fee Earned Per Liquidity:");
  // console.log(`${pool.token0.symbol}: ${fee0Annualized}`);
  // console.log(`${pool.token1.symbol}: ${fee1Annualized}`);
  // // 根据流动性估算年化的Fee
  // const liquidity = 5016665538715888; // 1个ETH、2500USDC上+200下-200Tick的流动性
  // const Fee0Earned = fee0Annualized * liquidity;
  // const Fee1Earned = fee1Annualized * liquidity;
  // console.log("Estimated Fee(readable) Earned:");
  // console.log(
  //   `${pool.token0.symbol}: ${Fee0Earned / 10 ** pool.token0.decimals}`
  // );
  // console.log(
  //   `${pool.token1.symbol}: ${Fee1Earned / 10 ** pool.token1.decimals}`
  // );
}

main()
  .then(() => process.exit(0))
  .catch((error) => console.error("Error loading estimateFee module:", error));
