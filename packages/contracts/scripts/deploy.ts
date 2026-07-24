import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const LIVE = {
  factory: "0x008c99EedA17E193e5F788536234C6b3520B8D15",
  router: "0xa973c5626eEaF7F482439753953e9B28C6aF3674",
  WXCN: "0x1a0Da75ADf091a69E7285e596bB27218D77E17a9",
  WETH: "0x9253587505c3B7E7b9DEE118AE1AcB53eEC0E4b6",
  USDC: "0xC8410270bb53f6c99A2EFe6eD3686a8630Efe22B",
} as const;

function xcnPlan(name: string, fallback: string): bigint {
  return ethers.parseUnits(process.env[name] || fallback, 18);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 327n) throw new Error(`Refusing chain ${network.chainId}`);

  for (const address of Object.values(LIVE)) {
    if ((await ethers.provider.getCode(address)) === "0x") {
      throw new Error(`Live dependency has no code: ${address}`);
    }
  }

  const finalAdmin = process.env.FINAL_ADMIN_ADDRESS;
  const treasury = process.env.TREASURY_ADDRESS;
  const reserve = process.env.RESERVE_ADDRESS;
  if (!finalAdmin || !treasury || !reserve) {
    throw new Error("Set FINAL_ADMIN_ADDRESS, TREASURY_ADDRESS, and RESERVE_ADDRESS");
  }
  for (const [label, value] of [["FINAL_ADMIN_ADDRESS", finalAdmin], ["TREASURY_ADDRESS", treasury], ["RESERVE_ADDRESS", reserve]] as const) {
    if (!ethers.isAddress(value) || value === ethers.ZeroAddress) throw new Error(`${label} is invalid`);
  }
  const normalized = [finalAdmin, treasury, reserve].map((value) => value.toLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new Error("Admin, treasury, and reserve must be separate addresses");
  if (finalAdmin.toLowerCase() === deployer.address.toLowerCase()) {
    throw new Error("Temporary deployer must not remain the final administrator");
  }

  const Tier = await ethers.getContractFactory("FlowTierManager");
  const tier = await Tier.deploy(deployer.address);
  const Token = await ethers.getContractFactory("FlowTokenRegistry");
  const token = await Token.deploy(deployer.address);
  const Strategy = await ethers.getContractFactory("FlowStrategyRegistry");
  const strategy = await Strategy.deploy(deployer.address, await tier.getAddress());
  const Fee = await ethers.getContractFactory("FlowFeeRouter");
  const fee = await Fee.deploy(deployer.address, treasury, reserve);
  const Execution = await ethers.getContractFactory("FlowExecutionRouter");
  const execution = await Execution.deploy(
    deployer.address,
    await token.getAddress(),
    await strategy.getAddress(),
    await fee.getAddress(),
    await tier.getAddress(),
  );
  const Factory = await ethers.getContractFactory("FlowVaultFactory");
  const vaultFactory = await Factory.deploy(await execution.getAddress(), LIVE.WXCN);
  const Adapter = await ethers.getContractFactory("OnyxV2Adapter");
  const adapter = await Adapter.deploy(deployer.address, LIVE.router, LIVE.factory);
  const Membership = await ethers.getContractFactory("FlowMembership");
  const membership = await Membership.deploy(
    deployer.address,
    LIVE.WXCN,
    await tier.getAddress(),
    treasury,
  );

  await Promise.all([
    tier.waitForDeployment(), token.waitForDeployment(), strategy.waitForDeployment(),
    fee.waitForDeployment(), execution.waitForDeployment(), vaultFactory.waitForDeployment(),
    adapter.waitForDeployment(), membership.waitForDeployment(),
  ]);

  await (await execution.setVaultFactory(await vaultFactory.getAddress())).wait();
  await (await execution.setAdapter(await adapter.getAddress(), true)).wait();
  await (await adapter.grantRole(await adapter.CALLER_ROLE(), await execution.getAddress())).wait();
  await (await fee.grantRole(await fee.DISTRIBUTOR_ROLE(), await execution.getAddress())).wait();

  await (await token.configureToken(LIVE.USDC, 3, 5_000_000_000n, 100, 6)).wait();
  await (await token.configureToken(LIVE.WXCN, 3, ethers.parseUnits("1000000", 18), 125, 18)).wait();
  await (await token.configureToken(LIVE.WETH, 3, ethers.parseUnits("2", 18), 100, 18)).wait();

  const officialStrategies = [
    {
      uri: "ipfs://flow-reserve", minimumTier: 0,
      rules: { reserveBps: 7000, rebalanceThresholdBps: 1000, maxTradeUsdE6: 100_000_000n, maxAssets: 2, momentumOnly: false, cooldownSeconds: 21600, maxTradesPerDay: 3 },
    },
    {
      uri: "ipfs://balanced-rotation", minimumTier: 1,
      rules: { reserveBps: 4500, rebalanceThresholdBps: 700, maxTradeUsdE6: 250_000_000n, maxAssets: 4, momentumOnly: false, cooldownSeconds: 7200, maxTradesPerDay: 6 },
    },
    {
      uri: "ipfs://active-momentum", minimumTier: 2,
      rules: { reserveBps: 2500, rebalanceThresholdBps: 500, maxTradeUsdE6: 500_000_000n, maxAssets: 6, momentumOnly: true, cooldownSeconds: 1800, maxTradesPerDay: 12 },
    },
  ] as const;
  for (const item of officialStrategies) {
    await (await strategy.submitStrategy(item.uri, treasury, item.rules)).wait();
    const id = (await strategy.nextStrategyId()) - 1n;
    await (await strategy.reviewStrategy(id, true, 0, item.minimumTier)).wait();
  }

  await (await membership.configurePlan(1, xcnPlan("FLOW_PLAN_XCN", "5000"), 30 * 86400, true)).wait();
  await (await membership.configurePlan(2, xcnPlan("PRO_PLAN_XCN", "15000"), 30 * 86400, true)).wait();
  await (await membership.configurePlan(3, xcnPlan("CREATOR_PLAN_XCN", "30000"), 30 * 86400, true)).wait();
  await (await tier.grantRole(await tier.TIER_ADMIN_ROLE(), await membership.getAddress())).wait();

  const contracts: any[] = [tier, token, strategy, fee, execution, adapter, membership];
  const adminRole = await execution.DEFAULT_ADMIN_ROLE();
  for (const contract of contracts) {
    await (await contract.grantRole(adminRole, finalAdmin)).wait();
  }

  const operationalRoles: Array<[any, string]> = [
    [tier, await tier.TIER_ADMIN_ROLE()],
    [token, await token.REGISTRY_ROLE()],
    [strategy, await strategy.REVIEWER_ROLE()],
    [execution, await execution.ADAPTER_ROLE()],
    [adapter, await adapter.CALLER_ROLE()],
  ];
  for (const [contract, role] of operationalRoles) {
    await (await contract.grantRole(role, finalAdmin)).wait();
  }

  for (const [contract, role] of operationalRoles) {
    await (await contract.renounceRole(role, deployer.address)).wait();
  }
  for (const contract of contracts) {
    await (await contract.renounceRole(adminRole, deployer.address)).wait();
  }

  const addresses = {
    version: "0.2.1",
    chainId: 327,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    finalAdmin,
    treasury,
    reserve,
    dependencies: LIVE,
    FlowTierManager: await tier.getAddress(),
    FlowTokenRegistry: await token.getAddress(),
    FlowStrategyRegistry: await strategy.getAddress(),
    FlowFeeRouter: await fee.getAddress(),
    FlowExecutionRouter: await execution.getAddress(),
    FlowVaultFactory: await vaultFactory.getAddress(),
    OnyxV2Adapter: await adapter.getAddress(),
    FlowMembership: await membership.getAddress(),
  };

  const output = path.resolve(__dirname, "../../../deployments.onyx.json");
  fs.writeFileSync(output, JSON.stringify(addresses, null, 2));
  console.log(JSON.stringify(addresses, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
