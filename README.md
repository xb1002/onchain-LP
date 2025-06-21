## 注意

1. 要将 price 转为 sqrtPrice，需要根据代币的小数点调整实际价格
   price=yAmount/xAmount ==> price\*10\*\*(token1.decimals-token0.decimals)
2. [estimate.ts](./src/estimateFee.ts)中获取数据与分析数据是同时写到 main 函数中，需要打注释已确定运行哪一个程序
   分析部分的 liquidity 需要自己计算
