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

const CONFIRMATIONS = 2;
const CODE_POLL_ATTEMPTS = 60;
const CODE_POLL_MS = 2_000;
const ESTIMATE_ATTEMPTS = 30;
const ESTIMATE_RETRY_MS = 2_000;
const BPS = 10_000n;
const GAS_LIMIT_BUFFER_BPS = 12_000n;
const GAS_PRICE_BUFFER_BPS = BigInt(process.env.ONYX_GAS_PRICE_BUFFER_BPS || "12500");
const MAX_GAS_PRICE = ethers.parseUnits(
  process.env.MAX_ONYX_GAS_PRICE_GWEI || "2500",
  "gwei",
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function currentGasPrice(): Promise<bigint> {
  const raw = await ethers.provider.send("eth_gasPrice", []);
  const quoted = BigInt(raw);
  if (quoted <= 0n) throw new Error("Onyx RPC returned an invalid gas price");

  const buffered = (quoted * GAS_PRICE_BUFFER_BPS + BPS - 1n) / BPS;
  if (buffered > MAX_GAS_PRICE) {
    throw new Error(
      `Onyx gas price ${ethers.formatUnits(buffered, "gwei")} gwei exceeds the configured safety cap ` +
      `${ethers.formatUnits(MAX_GAS_PRICE, "gwei")} gwei`,
    );
  }
  return buffered;
}

async function estimateGasWithRetry(
  label: string,
  signer: any,
  request: any,
): Promise<bigint> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ESTIMATE_ATTEMPTS; attempt += 1) {
    try {
      return await signer.estimateGas(request);
    } catch (error) {
      lastError = error;
      const message = errorMessage(error);
      const retryable =
        message.includes("BAD_INIT") ||
        message.includes("Requested resource not found") ||
        message.includes("UNKNOWN") ||
        message.includes("BUSY");

      if (!retryable || attempt === ESTIMATE_ATTEMPTS) throw error;
      console.log(
        `${label}: RPC state not ready for gas estimation ` +
        `(attempt ${attempt}/${ESTIMATE_ATTEMPTS}); retrying`,
      );
      await sleep(ESTIMATE_RETRY_MS);
    }
  }
  throw lastError;
}

async function transactionOverrides(
  label: string,
  signer: any,
  request: any,
): Promise<{ gasLimit: bigint; gasPrice: bigint; type: 0 }> {
  const estimate = await estimateGasWithRetry(label, signer, request);
  const gasLimit = (estimate * GAS_LIMIT_BUFFER_BPS + BPS - 1n) / BPS;
  const gasPrice = await currentGasPrice();
  const maximumFee = gasLimit * gasPrice;
  const balance = await ethers.provider.getBalance(await signer.getAddress());

  if (balance < maximumFee) {
    throw new Error(
      `${label}: deployer balance ${ethers.formatEther(balance)} XCN is below the ` +
      `maximum transaction fee ${ethers.formatEther(maximumFee)} XCN. ` +
      `Fund the Temporary Deployer with native XCN on Onyx and retry.`,
    );
  }

  console.log(
    `${label}: estimate=${estimate} gas, limit=${gasLimit}, ` +
    `gasPrice=${ethers.formatUnits(gasPrice, "gwei")} gwei, ` +
    `maxFee=${ethers.formatEther(maximumFee)} XCN`,
  );

  // Onyx's gateway is most reliable for deployment when given the live legacy
  // gas price explicitly instead of an inferred EIP-1559 fee tuple.
  return { gasLimit, gasPrice, type: 0 };
}

async function confirmDeployment(
  label: string,
  contract: any,
): Promise<{ address: string; transactionHash: string }> {
  const tx = contract.deploymentTransaction();
  if (!tx) throw new Error(`${label} has no deployment transaction`);

  console.log(`${label}: submitted ${tx.hash}`);
  const receipt = await tx.wait(CONFIRMATIONS);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} deployment transaction failed: ${tx.hash}`);
  }

  const predictedAddress = ethers.getAddress(await contract.getAddress());
  const receiptAddress = receipt.contractAddress && ethers.isAddress(receipt.contractAddress)
    ? ethers.getAddress(receipt.contractAddress)
    : null;

  // Onyx's JSON-RPC relay receipt is the authoritative source for the address
  // created by a contract-deployment transaction. Ethers may calculate a
  // different CREATE address locally on networks whose account/nonce model is
  // relayed into EVM semantics.
  const candidates = Array.from(new Set([
    receiptAddress,
    predictedAddress,
    receipt.to && ethers.isAddress(receipt.to) ? ethers.getAddress(receipt.to) : null,
  ].filter((value): value is string => Boolean(value))));

  if (receiptAddress && receiptAddress !== predictedAddress) {
    console.log(
      `${label}: receipt address ${receiptAddress} differs from ethers prediction ` +
      `${predictedAddress}; using the receipt address`,
    );
  }

  for (let attempt = 1; attempt <= CODE_POLL_ATTEMPTS; attempt += 1) {
    for (const candidate of candidates) {
      const code = await ethers.provider.getCode(candidate);
      if (code !== "0x") {
        if (candidate !== receiptAddress && receiptAddress) {
          throw new Error(
            `${label}: bytecode appeared at ${candidate}, but the deployment receipt ` +
            `reported ${receiptAddress}. Refusing an ambiguous deployment.`,
          );
        }
        console.log(
          `${label}: ${candidate} ` +
          `(receipt confirmed; code visible after ${attempt} check${attempt === 1 ? "" : "s"})`,
        );
        return { address: candidate, transactionHash: tx.hash };
      }
    }
    await sleep(CODE_POLL_MS);
  }

  throw new Error(
    `${label} transaction ${tx.hash} was mined, but bytecode was not visible at ` +
    `${candidates.join(", ")} after ${CODE_POLL_ATTEMPTS * CODE_POLL_MS / 1000}s`,
  );
}

async function deployAndConfirm(
  label: string,
  signer: any,
  factory: any,
  args: readonly unknown[],
): Promise<{ contract: any; address: string }> {
  const draft = await factory.getDeployTransaction(...args);
  const overrides = await transactionOverrides(label, signer, draft);
  const pendingContract = await factory.deploy(...args, overrides);
  const { address } = await confirmDeployment(label, pendingContract);

  // Always continue with a contract instance attached to the authoritative
  // address returned by the network receipt, not a locally predicted address.
  const contract = factory.attach(address).connect(signer);
  return { contract, address };
}

async function sendAndConfirm(
  label: string,
  signer: any,
  method: any,
  args: readonly unknown[],
): Promise<void> {
  const draft = await method.populateTransaction(...args);
  const overrides = await transactionOverrides(label, signer, draft);
  const transaction = await method(...args, overrides);
  const receipt = await transaction.wait(CONFIRMATIONS);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} transaction failed`);
  }
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
  const { contract: tier, address: tierAddress } = await deployAndConfirm(
    "FlowTierManager",
    deployer,
    Tier,
    [deployer.address],
  );

  const Token = await ethers.getContractFactory("FlowTokenRegistry");
  const { contract: token, address: tokenAddress } = await deployAndConfirm(
    "FlowTokenRegistry",
    deployer,
    Token,
    [deployer.address],
  );

  const Strategy = await ethers.getContractFactory("FlowStrategyRegistry");
  const { contract: strategy, address: strategyAddress } = await deployAndConfirm(
    "FlowStrategyRegistry",
    deployer,
    Strategy,
    [deployer.address, tierAddress],
  );

  const Fee = await ethers.getContractFactory("FlowFeeRouter");
  const { contract: fee, address: feeAddress } = await deployAndConfirm(
    "FlowFeeRouter",
    deployer,
    Fee,
    [deployer.address, treasury, reserve],
  );

  const Execution = await ethers.getContractFactory("FlowExecutionRouter");
  const { contract: execution, address: executionAddress } = await deployAndConfirm(
    "FlowExecutionRouter",
    deployer,
    Execution,
    [deployer.address, tokenAddress, strategyAddress, feeAddress, tierAddress],
  );

  const Factory = await ethers.getContractFactory("FlowVaultFactory");
  const { contract: vaultFactory, address: vaultFactoryAddress } = await deployAndConfirm(
    "FlowVaultFactory",
    deployer,
    Factory,
    [executionAddress, LIVE.WXCN],
  );

  const Adapter = await ethers.getContractFactory("OnyxV2Adapter");
  const { contract: adapter, address: adapterAddress } = await deployAndConfirm(
    "OnyxV2Adapter",
    deployer,
    Adapter,
    [deployer.address, LIVE.router, LIVE.factory],
  );

  const Membership = await ethers.getContractFactory("FlowMembership");
  const { contract: membership, address: membershipAddress } = await deployAndConfirm(
    "FlowMembership",
    deployer,
    Membership,
    [deployer.address, LIVE.WXCN, tierAddress, treasury],
  );

  await sendAndConfirm(
    "Set vault factory",
    deployer,
    execution.setVaultFactory,
    [vaultFactoryAddress],
  );
  await sendAndConfirm(
    "Enable Onyx adapter",
    deployer,
    execution.setAdapter,
    [adapterAddress, true],
  );
  await sendAndConfirm(
    "Grant adapter caller role",
    deployer,
    adapter.grantRole,
    [await adapter.CALLER_ROLE(), executionAddress],
  );
  await sendAndConfirm(
    "Grant fee distributor role",
    deployer,
    fee.grantRole,
    [await fee.DISTRIBUTOR_ROLE(), executionAddress],
  );

  await sendAndConfirm(
    "Configure USDC",
    deployer,
    token.configureToken,
    [LIVE.USDC, 3, 5_000_000_000n, 100, 6],
  );
  await sendAndConfirm(
    "Configure WXCN",
    deployer,
    token.configureToken,
    [LIVE.WXCN, 3, ethers.parseUnits("1000000", 18), 125, 18],
  );
  await sendAndConfirm(
    "Configure WETH",
    deployer,
    token.configureToken,
    [LIVE.WETH, 3, ethers.parseUnits("2", 18), 100, 18],
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
      deployer,
      strategy.submitStrategy,
      [item.uri, treasury, item.rules],
    );
    const id = (await strategy.nextStrategyId()) - 1n;
    await sendAndConfirm(
      `Review strategy ${id}`,
      deployer,
      strategy.reviewStrategy,
      [id, true, 0, item.minimumTier],
    );
  }

  await sendAndConfirm(
    "Configure Flow plan",
    deployer,
    membership.configurePlan,
    [1, xcnPlan("FLOW_PLAN_XCN", "5000"), 30 * 86400, true],
  );
  await sendAndConfirm(
    "Configure Pro plan",
    deployer,
    membership.configurePlan,
    [2, xcnPlan("PRO_PLAN_XCN", "15000"), 30 * 86400, true],
  );
  await sendAndConfirm(
    "Configure Creator plan",
    deployer,
    membership.configurePlan,
    [3, xcnPlan("CREATOR_PLAN_XCN", "30000"), 30 * 86400, true],
  );
  await sendAndConfirm(
    "Authorize membership tier grants",
    deployer,
    tier.grantRole,
    [await tier.TIER_ADMIN_ROLE(), membershipAddress],
  );

  const contracts: any[] = [tier, token, strategy, fee, execution, adapter, membership];
  const adminRole = await execution.DEFAULT_ADMIN_ROLE();
  for (const contract of contracts) {
    await sendAndConfirm(
      "Grant final admin role",
      deployer,
      contract.grantRole,
      [adminRole, finalAdmin],
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
      deployer,
      contract.grantRole,
      [role, finalAdmin],
    );
  }

  for (const [contract, role] of operationalRoles) {
    await sendAndConfirm(
      "Renounce deployer operational role",
      deployer,
      contract.renounceRole,
      [role, deployer.address],
    );
  }
  for (const contract of contracts) {
    await sendAndConfirm(
      "Renounce deployer admin role",
      deployer,
      contract.renounceRole,
      [adminRole, deployer.address],
    );
  }

  const addresses = {
    version: "0.2.9",
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
