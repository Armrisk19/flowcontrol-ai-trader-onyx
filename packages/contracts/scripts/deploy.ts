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

// Authoritative addresses from the successful v0.2.9 deployment receipts.
// This script resumes and verifies that deployment; it does not create duplicates.
const DEPLOYED = {
  FlowTierManager: "0x074F3973CeDCa8325a519ECFB05aD1E267d98Eec",
  FlowTokenRegistry: "0xee9517eB8aA0582c489066Cd44bb58F34D5B66dd",
  FlowStrategyRegistry: "0x9078F1c2Ef0E8dE5695af1774E4C14428B1cD568",
  FlowFeeRouter: "0x183CB62912880b2bCE9884A91719045B10Ee1e48",
  FlowExecutionRouter: "0xAA4B0F7B7dB1d17D84D41e2d89D7d7b0b9d30021",
  FlowVaultFactory: "0xF9B65242247d186038C368A870c97b1B53926B80",
  OnyxV2Adapter: "0x38A29B2aE638303935C3b6765B50d1C0bf5B71e0",
  FlowMembership: "0x57DEfA24f6990Ab0F8ec33A2AECF261Fc5677779",
} as const;

const CHAIN_ID = 327n;
const CONFIRMATIONS = 2;
const BPS = 10_000n;
const GAS_LIMIT_BUFFER_BPS = 12_000n;
const GAS_PRICE_BUFFER_BPS = BigInt(process.env.ONYX_GAS_PRICE_BUFFER_BPS || "12500");
const MAX_GAS_PRICE = ethers.parseUnits(
  process.env.MAX_ONYX_GAS_PRICE_GWEI || "2500",
  "gwei",
);
const RPC_ATTEMPTS = 6;
const RPC_RETRY_MS = 5_000;
const RECEIPT_POLL_ATTEMPTS = 90;
const RECEIPT_POLL_MS = 2_000;
const STATE_POLL_ATTEMPTS = 60;
const STATE_POLL_MS = 2_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryable(error: unknown): boolean {
  const value = message(error).toLowerCase();
  return [
    "headers timeout",
    "und_err_headers_timeout",
    "timeout",
    "econnreset",
    "socket hang up",
    "temporarily unavailable",
    "service unavailable",
    "gateway timeout",
    "bad gateway",
    "busy",
    "unknown",
    "requested resource not found",
  ].some((needle) => value.includes(needle));
}

async function readWithRetry<T>(label: string, read: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === RPC_ATTEMPTS) throw error;
      console.log(`${label}: RPC read retry ${attempt}/${RPC_ATTEMPTS}`);
      await sleep(RPC_RETRY_MS);
    }
  }
  throw lastError;
}

async function currentGasPrice(): Promise<bigint> {
  const raw = await readWithRetry("Read gas price", () =>
    ethers.provider.send("eth_gasPrice", []),
  );
  const quoted = BigInt(raw);
  if (quoted <= 0n) throw new Error("Onyx RPC returned an invalid gas price");

  const buffered = (quoted * GAS_PRICE_BUFFER_BPS + BPS - 1n) / BPS;
  if (buffered > MAX_GAS_PRICE) {
    throw new Error(
      `Onyx gas price ${ethers.formatUnits(buffered, "gwei")} gwei exceeds ` +
      `the configured cap ${ethers.formatUnits(MAX_GAS_PRICE, "gwei")} gwei`,
    );
  }
  return buffered;
}

async function transactionRequest(
  label: string,
  wallet: any,
  draft: any,
): Promise<any> {
  const estimate = await readWithRetry(`${label} gas estimate`, () =>
    wallet.estimateGas(draft),
  );
  const gasLimit = (estimate * GAS_LIMIT_BUFFER_BPS + BPS - 1n) / BPS;
  const gasPrice = await currentGasPrice();
  const nonce = await readWithRetry(`${label} nonce`, () =>
    ethers.provider.getTransactionCount(wallet.address, "pending"),
  );
  const balance = await readWithRetry(`${label} balance`, () =>
    ethers.provider.getBalance(wallet.address),
  );
  const maximumFee = gasLimit * gasPrice;
  if (balance < maximumFee) {
    throw new Error(
      `${label}: deployer balance ${ethers.formatEther(balance)} XCN is below ` +
      `the maximum fee ${ethers.formatEther(maximumFee)} XCN`,
    );
  }

  console.log(
    `${label}: estimate=${estimate} gas, limit=${gasLimit}, ` +
    `gasPrice=${ethers.formatUnits(gasPrice, "gwei")} gwei, ` +
    `maxFee=${ethers.formatEther(maximumFee)} XCN`,
  );

  return {
    to: draft.to,
    data: draft.data,
    value: draft.value ?? 0n,
    chainId: CHAIN_ID,
    nonce,
    gasLimit,
    gasPrice,
    type: 0,
  };
}

async function waitForReceipt(hash: string): Promise<any> {
  for (let attempt = 1; attempt <= RECEIPT_POLL_ATTEMPTS; attempt += 1) {
    const receipt = await readWithRetry(`Receipt ${hash}`, () =>
      ethers.provider.getTransactionReceipt(hash),
    );
    if (receipt) {
      if (receipt.status !== 1) throw new Error(`Transaction reverted: ${hash}`);

      while (true) {
        const head = await readWithRetry("Read confirmation height", () =>
          ethers.provider.getBlockNumber(),
        );
        if (head >= receipt.blockNumber + CONFIRMATIONS - 1) return receipt;
        await sleep(RECEIPT_POLL_MS);
      }
    }
    await sleep(RECEIPT_POLL_MS);
  }
  throw new Error(`Transaction receipt was not visible after polling: ${hash}`);
}

async function broadcastKnownTransaction(
  label: string,
  wallet: any,
  request: any,
): Promise<string> {
  const signed = await wallet.signTransaction(request);
  const hash = ethers.keccak256(signed);
  console.log(`${label}: signed ${hash}`);

  for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt += 1) {
    try {
      await ethers.provider.broadcastTransaction(signed);
      console.log(`${label}: broadcast accepted`);
      break;
    } catch (error) {
      const value = message(error).toLowerCase();
      const alreadyKnown =
        value.includes("already known") ||
        value.includes("known transaction") ||
        value.includes("nonce too low");
      if (alreadyKnown) {
        console.log(`${label}: transaction already accepted; polling ${hash}`);
        break;
      }
      if (!isRetryable(error) || attempt === RPC_ATTEMPTS) throw error;
      console.log(
        `${label}: broadcast response unavailable ` +
        `(${attempt}/${RPC_ATTEMPTS}); rebroadcasting the same signed transaction`,
      );
      await sleep(RPC_RETRY_MS);
    }
  }

  await waitForReceipt(hash);
  return hash;
}

async function waitForState(
  label: string,
  isComplete: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 1; attempt <= STATE_POLL_ATTEMPTS; attempt += 1) {
    if (await readWithRetry(`${label} state`, isComplete)) return;
    await sleep(STATE_POLL_MS);
  }
  throw new Error(`${label}: transaction confirmed but expected state was not visible`);
}

async function ensureAction(
  label: string,
  wallet: any,
  isComplete: () => Promise<boolean>,
  method: any,
  args: readonly unknown[],
): Promise<void> {
  if (await readWithRetry(`${label} precheck`, isComplete)) {
    console.log(`${label}: already complete; skipped`);
    return;
  }

  const draft = await readWithRetry(`${label} populate`, () =>
    method.populateTransaction(...args),
  );
  const request = await transactionRequest(label, wallet, draft);
  const hash = await broadcastKnownTransaction(label, wallet, request);
  await waitForState(label, isComplete);
  console.log(`${label}: confirmed ${hash}`);
}

function same(a: string, b: string): boolean {
  return ethers.getAddress(a) === ethers.getAddress(b);
}

function asNumber(value: any): number {
  return Number(BigInt(value));
}

function xcnPlan(name: string, fallback: string): bigint {
  return ethers.parseUnits(process.env[name] || fallback, 18);
}

async function requireCode(label: string, address: string): Promise<void> {
  const code = await readWithRetry(`${label} code`, () =>
    ethers.provider.getCode(address),
  );
  if (code === "0x") throw new Error(`${label} has no code at ${address}`);
}

async function main() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY is required");

  const wallet = new ethers.Wallet(privateKey, ethers.provider);
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(`Refusing chain ${network.chainId}; expected ${CHAIN_ID}`);
  }

  const finalAdmin = process.env.FINAL_ADMIN_ADDRESS;
  const treasury = process.env.TREASURY_ADDRESS;
  const reserve = process.env.RESERVE_ADDRESS;
  if (!finalAdmin || !treasury || !reserve) {
    throw new Error(
      "Set FINAL_ADMIN_ADDRESS, TREASURY_ADDRESS, and RESERVE_ADDRESS",
    );
  }

  for (const [label, value] of [
    ["FINAL_ADMIN_ADDRESS", finalAdmin],
    ["TREASURY_ADDRESS", treasury],
    ["RESERVE_ADDRESS", reserve],
  ] as const) {
    if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
      throw new Error(`${label} is invalid`);
    }
  }

  const normalized = [finalAdmin, treasury, reserve].map((value) =>
    value.toLowerCase(),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Admin, treasury, and reserve must be separate addresses");
  }
  if (same(finalAdmin, wallet.address)) {
    throw new Error("Temporary deployer must not remain final administrator");
  }

  for (const [label, address] of Object.entries({ ...LIVE, ...DEPLOYED })) {
    await requireCode(label, address);
  }

  const tier: any = await ethers.getContractAt(
    "FlowTierManager",
    DEPLOYED.FlowTierManager,
    wallet,
  );
  const token: any = await ethers.getContractAt(
    "FlowTokenRegistry",
    DEPLOYED.FlowTokenRegistry,
    wallet,
  );
  const strategy: any = await ethers.getContractAt(
    "FlowStrategyRegistry",
    DEPLOYED.FlowStrategyRegistry,
    wallet,
  );
  const fee: any = await ethers.getContractAt(
    "FlowFeeRouter",
    DEPLOYED.FlowFeeRouter,
    wallet,
  );
  const execution: any = await ethers.getContractAt(
    "FlowExecutionRouter",
    DEPLOYED.FlowExecutionRouter,
    wallet,
  );
  const vaultFactory: any = await ethers.getContractAt(
    "FlowVaultFactory",
    DEPLOYED.FlowVaultFactory,
    wallet,
  );
  const adapter: any = await ethers.getContractAt(
    "OnyxV2Adapter",
    DEPLOYED.OnyxV2Adapter,
    wallet,
  );
  const membership: any = await ethers.getContractAt(
    "FlowMembership",
    DEPLOYED.FlowMembership,
    wallet,
  );

  // Verify constructor wiring before any further transaction.
  const wiring = [
    ["strategy.tierManager", await strategy.tierManager(), DEPLOYED.FlowTierManager],
    ["fee.treasury", await fee.treasury(), treasury],
    ["fee.reserve", await fee.reserve(), reserve],
    ["execution.tokenRegistry", await execution.tokenRegistry(), DEPLOYED.FlowTokenRegistry],
    ["execution.strategyRegistry", await execution.strategyRegistry(), DEPLOYED.FlowStrategyRegistry],
    ["execution.feeRouter", await execution.feeRouter(), DEPLOYED.FlowFeeRouter],
    ["execution.tierManager", await execution.tierManager(), DEPLOYED.FlowTierManager],
    ["factory.executionRouter", await vaultFactory.executionRouter(), DEPLOYED.FlowExecutionRouter],
    ["factory.wrappedNative", await vaultFactory.wrappedNative(), LIVE.WXCN],
    ["adapter.router", await adapter.router(), LIVE.router],
    ["adapter.factory", await adapter.factory(), LIVE.factory],
    ["membership.paymentToken", await membership.paymentToken(), LIVE.WXCN],
    ["membership.tierManager", await membership.tierManager(), DEPLOYED.FlowTierManager],
    ["membership.treasury", await membership.treasury(), treasury],
  ] as const;
  for (const [label, actual, expected] of wiring) {
    if (!same(actual, expected)) {
      throw new Error(`${label} mismatch: ${actual} != ${expected}`);
    }
  }
  console.log("Constructor wiring: verified");

  const currentVaultFactory = await execution.vaultFactory();
  if (currentVaultFactory !== ethers.ZeroAddress &&
      !same(currentVaultFactory, DEPLOYED.FlowVaultFactory)) {
    throw new Error(`Unexpected vault factory: ${currentVaultFactory}`);
  }
  await ensureAction(
    "Set vault factory",
    wallet,
    async () => same(await execution.vaultFactory(), DEPLOYED.FlowVaultFactory),
    execution.setVaultFactory,
    [DEPLOYED.FlowVaultFactory],
  );

  await ensureAction(
    "Enable Onyx adapter",
    wallet,
    async () => Boolean(await execution.approvedAdapters(DEPLOYED.OnyxV2Adapter)),
    execution.setAdapter,
    [DEPLOYED.OnyxV2Adapter, true],
  );

  const callerRole = await adapter.CALLER_ROLE();
  await ensureAction(
    "Grant adapter caller role",
    wallet,
    async () => Boolean(await adapter.hasRole(callerRole, DEPLOYED.FlowExecutionRouter)),
    adapter.grantRole,
    [callerRole, DEPLOYED.FlowExecutionRouter],
  );

  const distributorRole = await fee.DISTRIBUTOR_ROLE();
  await ensureAction(
    "Grant fee distributor role",
    wallet,
    async () => Boolean(await fee.hasRole(distributorRole, DEPLOYED.FlowExecutionRouter)),
    fee.grantRole,
    [distributorRole, DEPLOYED.FlowExecutionRouter],
  );

  const tokenSpecs = [
    {
      label: "USDC",
      address: LIVE.USDC,
      status: 3,
      maxTradeAmount: 5_000_000_000n,
      maxSlippageBps: 100,
      decimals: 6,
    },
    {
      label: "WXCN",
      address: LIVE.WXCN,
      status: 3,
      maxTradeAmount: ethers.parseUnits("1000000", 18),
      maxSlippageBps: 125,
      decimals: 18,
    },
    {
      label: "WETH",
      address: LIVE.WETH,
      status: 3,
      maxTradeAmount: ethers.parseUnits("2", 18),
      maxSlippageBps: 100,
      decimals: 18,
    },
  ] as const;

  const tokenMatches = async (spec: typeof tokenSpecs[number]): Promise<boolean> => {
    const config = await token.getToken(spec.address);
    return Boolean(config.exists) &&
      asNumber(config.status) === spec.status &&
      BigInt(config.maxTradeAmount) === spec.maxTradeAmount &&
      asNumber(config.maxSlippageBps) === spec.maxSlippageBps &&
      asNumber(config.decimals) === spec.decimals;
  };

  for (const spec of tokenSpecs) {
    await ensureAction(
      `Configure ${spec.label}`,
      wallet,
      () => tokenMatches(spec),
      token.configureToken,
      [
        spec.address,
        spec.status,
        spec.maxTradeAmount,
        spec.maxSlippageBps,
        spec.decimals,
      ],
    );
  }

  const officialStrategies = [
    {
      uri: "ipfs://flow-reserve",
      minimumTier: 0,
      rules: {
        reserveBps: 7000,
        rebalanceThresholdBps: 1000,
        maxTradeUsdE6: 100_000_000n,
        maxAssets: 2,
        momentumOnly: false,
        cooldownSeconds: 21600,
        maxTradesPerDay: 3,
      },
    },
    {
      uri: "ipfs://balanced-rotation",
      minimumTier: 1,
      rules: {
        reserveBps: 4500,
        rebalanceThresholdBps: 700,
        maxTradeUsdE6: 250_000_000n,
        maxAssets: 4,
        momentumOnly: false,
        cooldownSeconds: 7200,
        maxTradesPerDay: 6,
      },
    },
    {
      uri: "ipfs://active-momentum",
      minimumTier: 2,
      rules: {
        reserveBps: 2500,
        rebalanceThresholdBps: 500,
        maxTradeUsdE6: 500_000_000n,
        maxAssets: 6,
        momentumOnly: true,
        cooldownSeconds: 1800,
        maxTradesPerDay: 12,
      },
    },
  ] as const;

  const findStrategy = async (item: typeof officialStrategies[number]): Promise<bigint> => {
    const expectedHash = await strategy.hashRules(item.rules);
    const next = BigInt(await strategy.nextStrategyId());
    for (let id = 1n; id < next; id += 1n) {
      const current = await strategy.getStrategy(id);
      if (
        current.metadataURI === item.uri &&
        String(current.rulesHash).toLowerCase() === String(expectedHash).toLowerCase()
      ) {
        return id;
      }
    }
    return 0n;
  };

  for (const item of officialStrategies) {
    await ensureAction(
      `Submit strategy ${item.uri}`,
      wallet,
      async () => (await findStrategy(item)) !== 0n,
      strategy.submitStrategy,
      [item.uri, treasury, item.rules],
    );

    const id = await readWithRetry(`Find ${item.uri}`, () => findStrategy(item));
    if (id === 0n) throw new Error(`Strategy not found after submission: ${item.uri}`);

    await ensureAction(
      `Review strategy ${id}`,
      wallet,
      async () => {
        const current = await strategy.getStrategy(id);
        return Boolean(current.active) &&
          asNumber(current.creatorFeeBps) === 0 &&
          asNumber(current.minimumTier) === item.minimumTier &&
          same(current.payout, treasury);
      },
      strategy.reviewStrategy,
      [id, true, 0, item.minimumTier],
    );
  }

  const plans = [
    { tier: 1, price: xcnPlan("FLOW_PLAN_XCN", "5000") },
    { tier: 2, price: xcnPlan("PRO_PLAN_XCN", "15000") },
    { tier: 3, price: xcnPlan("CREATOR_PLAN_XCN", "30000") },
  ] as const;
  const duration = 30 * 86400;

  for (const plan of plans) {
    await ensureAction(
      `Configure membership tier ${plan.tier}`,
      wallet,
      async () => {
        const current = await membership.plans(plan.tier);
        return BigInt(current.price) === plan.price &&
          asNumber(current.duration) === duration &&
          Boolean(current.enabled);
      },
      membership.configurePlan,
      [plan.tier, plan.price, duration, true],
    );
  }

  const tierAdminRole = await tier.TIER_ADMIN_ROLE();
  await ensureAction(
    "Authorize membership tier grants",
    wallet,
    async () => Boolean(await tier.hasRole(tierAdminRole, DEPLOYED.FlowMembership)),
    tier.grantRole,
    [tierAdminRole, DEPLOYED.FlowMembership],
  );

  // Staged release: the on-chain gate remains closed until an intentional
  // post-audit release from the Final Admin account.
  await ensureAction(
    "Pause execution router for staged release",
    wallet,
    async () => Boolean(await execution.paused()),
    execution.pause,
    [],
  );

  const contracts: any[] = [tier, token, strategy, fee, execution, adapter, membership];
  const adminRole = await execution.DEFAULT_ADMIN_ROLE();
  for (const contract of contracts) {
    const address = await contract.getAddress();
    await ensureAction(
      `Grant final admin on ${address}`,
      wallet,
      async () => Boolean(await contract.hasRole(adminRole, finalAdmin)),
      contract.grantRole,
      [adminRole, finalAdmin],
    );
  }

  const registryRole = await token.REGISTRY_ROLE();
  const reviewerRole = await strategy.REVIEWER_ROLE();
  const adapterRole = await execution.ADAPTER_ROLE();
  const operationalRoles: Array<[any, string, string]> = [
    [tier, tierAdminRole, "tier admin"],
    [token, registryRole, "token registry"],
    [strategy, reviewerRole, "strategy reviewer"],
    [execution, adapterRole, "execution adapter admin"],
    [adapter, callerRole, "adapter caller"],
  ];

  for (const [contract, role, label] of operationalRoles) {
    await ensureAction(
      `Grant final ${label}`,
      wallet,
      async () => Boolean(await contract.hasRole(role, finalAdmin)),
      contract.grantRole,
      [role, finalAdmin],
    );
  }

  // All configuration and final-admin grants are complete before any deployer
  // authority is removed. Every renounce is also safe to resume.
  for (const [contract, role, label] of operationalRoles) {
    await ensureAction(
      `Renounce deployer ${label}`,
      wallet,
      async () => !(await contract.hasRole(role, wallet.address)),
      contract.renounceRole,
      [role, wallet.address],
    );
  }

  for (const contract of contracts) {
    const address = await contract.getAddress();
    await ensureAction(
      `Renounce deployer admin on ${address}`,
      wallet,
      async () => !(await contract.hasRole(adminRole, wallet.address)),
      contract.renounceRole,
      [adminRole, wallet.address],
    );
  }

  // Final fail-closed verification.
  if (!(await execution.paused())) throw new Error("Execution router is not paused");
  for (const contract of contracts) {
    if (!(await contract.hasRole(adminRole, finalAdmin))) {
      throw new Error(`Final Admin is missing on ${await contract.getAddress()}`);
    }
    if (await contract.hasRole(adminRole, wallet.address)) {
      throw new Error(`Temporary Deployer still has admin on ${await contract.getAddress()}`);
    }
  }
  for (const [contract, role, label] of operationalRoles) {
    if (!(await contract.hasRole(role, finalAdmin))) {
      throw new Error(`Final Admin is missing ${label}`);
    }
    if (await contract.hasRole(role, wallet.address)) {
      throw new Error(`Temporary Deployer still has ${label}`);
    }
  }
  console.log("Authority handoff: verified");

  const addresses = {
    version: "0.2.10",
    mode: "resumed-existing-deployment",
    chainId: Number(CHAIN_ID),
    completedAt: new Date().toISOString(),
    temporaryDeployer: wallet.address,
    finalAdmin,
    treasury,
    reserve,
    executionPaused: true,
    dependencies: LIVE,
    ...DEPLOYED,
  };

  const output = path.resolve(__dirname, "../../../deployments.onyx.json");
  fs.writeFileSync(output, JSON.stringify(addresses, null, 2));
  console.log(JSON.stringify(addresses, null, 2));
  console.log("Deployment resumed, verified, paused, and handed off successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
