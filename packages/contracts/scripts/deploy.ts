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

const DEPLOY_GAS_LIMIT = 8_000_000n;
const ADMIN_GAS_LIMIT = 2_000_000n;
const CONFIRMATIONS = 2;
const CODE_POLL_ATTEMPTS = 60;
const CODE_POLL_MS = 2_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function confirmDeployment(label: string, contract: any): Promise<string> {
  const tx = contract.deploymentTransaction();
  if (!tx) throw new Error(`${label} has no deployment transaction`);

  const receipt = await tx.wait(CONFIRMATIONS);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} deployment transaction failed`);
  }

  const address = await contract.getAddress();
  for (let attempt = 1; attempt <= CODE_POLL_ATTEMPTS; attempt += 1) {
    const code = await ethers.provider.getCode(address);
    if (code !== "0x") {
      console.log(`${label}: ${address} (code visible after ${attempt} check${attempt === 1 ? "" : "s"})`);
      return address;
    }
    await sleep(CODE_POLL_MS);
  }

  throw new Error(`${label} was mined but bytecode was not visible through the RPC after ${CODE_POLL_ATTEMPTS * CODE_POLL_MS / 1000}s`);
}

async function sendAndConfirm(label: string, transactionPromise: Promise<any>): Promise<void> {
  const transaction = await transactionPromise;
  const receipt = await transaction.wait(CONFIRMATIONS);
  if (!receipt || receipt.status !== 1) throw new Error(`${label} transaction failed`);
  console.log(`${label}: confirmed`);
}

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
  const tier = await Tier.deploy(deployer.address, { gasLimit: DEPLOY_GAS_LIMIT });
  const tierAddress = await confirmDeployment("FlowTierManager", tier);

  const Token = await ethers.getContractFactory("FlowTokenRegistry");
  const token = await Token.deploy(deployer.address, { gasLimit: DEPLOY_GAS_LIMIT });
  const tokenAddress = await confirmDeployment("FlowTokenRegistry", token);

  const Strategy = await ethers.getContractFactory("FlowStrategyRegistry");
  const strategy = await Strategy.deploy(
    deployer.address,
    tierAddress,
    { gasLimit: DEPLOY_GAS_LIMIT },
  );
  const strategyAddress = await confirmDeployment("FlowStrategyRegistry", strategy);

  const Fee = await ethers.getContractFactory("FlowFeeRouter");
  const fee = await Fee.deploy(
    deployer.address,
    treasury,
    reserve,
    { gasLimit: DEPLOY_GAS_LIMIT },
  );
  const feeAddress = await confirmDeployment("FlowFeeRouter", fee);

  const Execution = await ethers.getContractFactory("FlowExecutionRouter");
  const execution = await Execution.deploy(
    deployer.address,
    tokenAddress,
    strategyAddress,
    feeAddress,
    tierAddress,
    { gasLimit: DEPLOY_GAS_LIMIT },
  );
  const executionAddress = await confirmDeployment("FlowExecutionRouter", execution);

  const Factory = await ethers.getContractFactory("FlowVaultFactory");
  const vaultFactory = await Factory.deploy(
    executionAddress,
    LIVE.WXCN,
    { gasLimit: DEPLOY_GAS_LIMIT },
  );
  const vaultFactoryAddress = await confirmDeployment("FlowVaultFactory", vaultFactory);

  const Adapter = await ethers.getContractFactory("OnyxV2Adapter");
  const adapter = await Adapter.deploy(
    deployer.address,
    LIVE.router,
    LIVE.factory,
    { gasLimit: DEPLOY_GAS_LIMIT },
  );
  const adapterAddress = await confirmDeployment("OnyxV2Adapter", adapter);

  const Membership = await ethers.getContractFactory("FlowMembership");
  const membership = await Membership.deploy(
    deployer.address,
    LIVE.WXCN,
    tierAddress,
    treasury,
    { gasLimit: DEPLOY_GAS_LIMIT },
  );
  const membershipAddress = await confirmDeployment("FlowMembership", membership);

  await sendAndConfirm(
    "Set vault factory",
    execution.setVaultFactory(vaultFactoryAddress, { gasLimit: ADMIN_GAS_LIMIT }),
  );
  await sendAndConfirm(
    "Enable Onyx adapter",
    execution.setAdapter(adapterAddress, true, { gasLimit: ADMIN_GAS_LIMIT }),
  );
  await sendAndConfirm(
    "Grant adapter caller role",
    adapter.grantRole(await adapter.CALLER_ROLE(), executionAddress, { gasLimit: ADMIN_GAS_LIMIT }),
  );
  await sendAndConfirm(
    "Grant fee distributor role",
    fee.grantRole(await fee.DISTRIBUTOR_ROLE(), executionAddress, { gasLimit: ADMIN_GAS_LIMIT }),
  );

  await sendAndConfirm(
    "Configure USDC",
    token.configureToken(LIVE.USDC, 3, 5_000_000_000n, 100, 6, { gasLimit: ADMIN_GAS_LIMIT }),
  );
  await sendAndConfirm(
    "Configure WXCN",
    token.configureToken(LIVE.WXCN, 3, ethers.parseUnits("1000000", 18), 125, 18, { gasLimit: ADMIN_GAS_LIMIT }),
  );
  await sendAndConfirm(
    "Configure WETH",
    token.configureToken(LIVE.WETH, 3, ethers.parseUnits("2", 18), 100, 18, { gasLimit: ADMIN_GAS_LIMIT }),
  );

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
    await sendAndConfirm(
      `Submit strategy ${item.uri}`,
      strategy.submitStrategy(item.uri, treasury, item.rules, { gasLimit: ADMIN_GAS_LIMIT }),
    );
    const id = (await strategy.nextStrategyId()) - 1n;
    await sendAndConfirm(
      `Review strategy ${id}`,
      strategy.reviewStrategy(id, true, 0, item.minimumTier, { gasLimit: ADMIN_GAS_LIMIT }),
    );
  }

  await sendAndConfirm(
    "Configure Flow plan",
    membership.configurePlan(1, xcnPlan("FLOW_PLAN_XCN", "5000"), 30 * 86400, true, { gasLimit: ADMIN_GAS_LIMIT }),
  );
  await sendAndConfirm(
    "Configure Pro plan",
    membership.configurePlan(2, xcnPlan("PRO_PLAN_XCN", "15000"), 30 * 86400, true, { gasLimit: ADMIN_GAS_LIMIT }),
  );
  await sendAndConfirm(
    "Configure Creator plan",
    membership.configurePlan(3, xcnPlan("CREATOR_PLAN_XCN", "30000"), 30 * 86400, true, { gasLimit: ADMIN_GAS_LIMIT }),
  );
  await sendAndConfirm(
    "Authorize membership tier grants",
    tier.grantRole(await tier.TIER_ADMIN_ROLE(), membershipAddress, { gasLimit: ADMIN_GAS_LIMIT }),
  );

  const contracts: any[] = [tier, token, strategy, fee, execution, adapter, membership];
  const adminRole = await execution.DEFAULT_ADMIN_ROLE();
  for (const contract of contracts) {
    await sendAndConfirm(
      "Grant final admin role",
      contract.grantRole(adminRole, finalAdmin, { gasLimit: ADMIN_GAS_LIMIT }),
    );
  }

  const operationalRoles: Array<[any, string]> = [
    [tier, await tier.TIER_ADMIN_ROLE()],
    [token, await token.REGISTRY_ROLE()],
    [strategy, await strategy.REVIEWER_ROLE()],
    [execution, await execution.ADAPTER_ROLE()],
    [adapter, await adapter.CALLER_ROLE()],
  ];
  for (const [contract, role] of operationalRoles) {
    await sendAndConfirm(
      "Grant final operational role",
      contract.grantRole(role, finalAdmin, { gasLimit: ADMIN_GAS_LIMIT }),
    );
  }

  for (const [contract, role] of operationalRoles) {
    await sendAndConfirm(
      "Renounce deployer operational role",
      contract.renounceRole(role, deployer.address, { gasLimit: ADMIN_GAS_LIMIT }),
    );
  }
  for (const contract of contracts) {
    await sendAndConfirm(
      "Renounce deployer admin role",
      contract.renounceRole(adminRole, deployer.address, { gasLimit: ADMIN_GAS_LIMIT }),
    );
  }

  const addresses = {
    version: "0.2.7",
    chainId: 327,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    finalAdmin,
    treasury,
    reserve,
    dependencies: LIVE,
    FlowTierManager: tierAddress,
    FlowTokenRegistry: tokenAddress,
    FlowStrategyRegistry: strategyAddress,
    FlowFeeRouter: feeAddress,
    FlowExecutionRouter: executionAddress,
    FlowVaultFactory: vaultFactoryAddress,
    OnyxV2Adapter: adapterAddress,
    FlowMembership: membershipAddress,
  };

  const output = path.resolve(__dirname, "../../../deployments.onyx.json");
  fs.writeFileSync(output, JSON.stringify(addresses, null, 2));
  console.log(JSON.stringify(addresses, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
