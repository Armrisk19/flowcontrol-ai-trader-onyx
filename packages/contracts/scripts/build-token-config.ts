import { ethers } from "hardhat";

const FACTORY = "0x008c99EedA17E193e5F788536234C6b3520B8D15";
const ROUTER = "0xa973c5626eEaF7F482439753953e9B28C6aF3674";
const USDC = "0xC8410270bb53f6c99A2EFe6eD3686a8630Efe22B";

async function main() {
  const token = ethers.getAddress(process.env.TOKEN_ADDRESS || "");
  const registry = ethers.getAddress(process.env.FLOW_TOKEN_REGISTRY || "");
  const maxTradeUsd = Number(process.env.MAX_TRADE_USD || "100");
  const slippageBps = Number(process.env.MAX_SLIPPAGE_BPS || "100");
  const status = Number(process.env.TOKEN_STATUS || "2"); // 2 LIMITED, 3 ACTIVE
  if (![2,3].includes(status) || maxTradeUsd < 5 || slippageBps < 1 || slippageBps > 500) throw new Error("Unsafe configuration input");
  for (const [name,address] of Object.entries({token,registry,FACTORY,ROUTER,USDC})) if (await ethers.provider.getCode(address) === "0x") throw new Error(`${name} has no code`);
  const erc20 = new ethers.Contract(token,["function symbol() view returns(string)","function decimals() view returns(uint8)"],ethers.provider);
  const factory = new ethers.Contract(FACTORY,["function getPair(address,address) view returns(address)"],ethers.provider);
  const router = new ethers.Contract(ROUTER,["function getAmountsOut(uint256,address[]) view returns(uint256[] memory)"],ethers.provider);
  const [symbol,decimals,pair] = await Promise.all([erc20.symbol(),erc20.decimals(),factory.getPair(token,USDC)]);
  if (pair === ethers.ZeroAddress || await ethers.provider.getCode(pair) === "0x") throw new Error("No executable direct-USDC pool");
  const usdcIn = ethers.parseUnits(maxTradeUsd.toFixed(6),6);
  const buy = await router.getAmountsOut(usdcIn,[USDC,token]);
  const sell = await router.getAmountsOut(buy[1],[token,USDC]);
  const returned = sell[1] > usdcIn ? usdcIn : sell[1];
  const roundTripBps = Number((usdcIn-returned)*10_000n/usdcIn);
  if (roundTripBps > 150) throw new Error(`Round-trip cost ${roundTripBps} bps exceeds 150 bps`);
  const iface = new ethers.Interface(["function configureToken(address token,uint8 status,uint96 maxTradeAmount,uint16 maxSlippageBps,uint8 decimals)"]);
  const calldata = iface.encodeFunctionData("configureToken",[token,status,buy[1],slippageBps,decimals]);
  console.log(JSON.stringify({symbol,token,pair,maxTradeUsd,maxTradeAmount:buy[1].toString(),roundTripBps,status,slippageBps,registry,calldata},null,2));
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
