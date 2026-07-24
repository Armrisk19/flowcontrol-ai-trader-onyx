export const factoryAbi = [
  { type: "function", name: "vaultOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "createVault", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "vault", type: "address" }] },
] as const;

export const vaultAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "automationArmed", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "executor", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "executorExpiry", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "tokenAllowed", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "maxTradeAmount", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "setExecutor", stateMutability: "nonpayable", inputs: [{ name: "executor_", type: "address" }, { name: "expiry", type: "uint64" }], outputs: [] },
  { type: "function", name: "revokeExecutor", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "setAutomationArmed", stateMutability: "nonpayable", inputs: [{ name: "armed", type: "bool" }], outputs: [] },
  { type: "function", name: "setGlobalLimits", stateMutability: "nonpayable", inputs: [{ name: "cooldown", type: "uint32" }, { name: "tradesPerDay", type: "uint16" }], outputs: [] },
  {
    type: "function", name: "setTokenPolicies", stateMutability: "nonpayable",
    inputs: [
      { name: "tokens", type: "address[]" }, { name: "allowed", type: "bool[]" },
      { name: "perTrade", type: "uint256[]" }, { name: "perDay", type: "uint256[]" },
      { name: "reserve", type: "uint256[]" },
    ], outputs: [],
  },
  {
    type: "function", name: "configureAutomation", stateMutability: "nonpayable",
    inputs: [
      { name: "strategyId", type: "uint256" }, { name: "cooldown", type: "uint32" },
      { name: "tradesPerDay", type: "uint16" }, { name: "executor_", type: "address" },
      { name: "expiry", type: "uint64" },
    ], outputs: [],
  },
  { type: "function", name: "setStrategyAllowed", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }, { name: "allowed", type: "bool" }], outputs: [] },
  { type: "function", name: "pause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "unpause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "depositNative", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "withdrawNative", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }, { name: "recipient", type: "address" }], outputs: [] },
  {
    type: "function", name: "executeSwap", stateMutability: "nonpayable",
    inputs: [
      { name: "adapter", type: "address" }, { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" }, { name: "strategyId", type: "uint256" },
      { name: "referrer", type: "address" }, { name: "adapterData", type: "bytes" },
    ], outputs: [{ name: "amountOut", type: "uint256" }],
  },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }, { name: "recipient", type: "address" }], outputs: [] },
] as const;

export const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

export const routerAbi = [{
  type: "function", name: "getAmountsOut", stateMutability: "view",
  inputs: [{ name: "amountIn", type: "uint256" }, { name: "path", type: "address[]" }],
  outputs: [{ name: "amounts", type: "uint256[]" }],
}] as const;

export const tierAbi = [
  { type: "function", name: "tierOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint8" }] },
  {
    type: "function", name: "tierGrant", stateMutability: "view", inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "tier", type: "uint8" }, { name: "expiresAt", type: "uint64" }],
  },
] as const;

export const membershipAbi = [
  {
    type: "function", name: "plans", stateMutability: "view", inputs: [{ name: "tier", type: "uint8" }],
    outputs: [{ name: "price", type: "uint96" }, { name: "duration", type: "uint32" }, { name: "enabled", type: "bool" }],
  },
  { type: "function", name: "subscribe", stateMutability: "nonpayable", inputs: [{ name: "tier", type: "uint8" }], outputs: [] },
  { type: "function", name: "subscribeNative", stateMutability: "payable", inputs: [{ name: "tier", type: "uint8" }], outputs: [] },
] as const;

export const strategyRegistryWebAbi = [
  { type: "function", name: "nextStrategyId", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "hasRole", stateMutability: "view", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  {
    type: "function", name: "submitStrategy", stateMutability: "nonpayable",
    inputs: [
      { name: "metadataURI", type: "string" }, { name: "payout", type: "address" },
      { name: "rules", type: "tuple", components: [
        { name: "reserveBps", type: "uint16" },
        { name: "rebalanceThresholdBps", type: "uint16" },
        { name: "maxTradeUsdE6", type: "uint64" },
        { name: "maxAssets", type: "uint8" },
        { name: "momentumOnly", type: "bool" },
        { name: "cooldownSeconds", type: "uint32" },
        { name: "maxTradesPerDay", type: "uint16" },
      ] },
    ], outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function", name: "reviewStrategy", stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" }, { name: "active", type: "bool" },
      { name: "feeShareBps", type: "uint16" }, { name: "minimumTier_", type: "uint8" },
    ], outputs: [],
  },
  {
    type: "event", name: "StrategySubmitted", anonymous: false,
    inputs: [
      { indexed: true, name: "strategyId", type: "uint256" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: true, name: "rulesHash", type: "bytes32" },
      { indexed: false, name: "metadataURI", type: "string" },
    ],
  },
] as const;


export const executionRouterViewAbi = [
  { type: "function", name: "tierFeeBps", stateMutability: "view", inputs: [{ name: "tier", type: "uint8" }], outputs: [{ name: "", type: "uint16" }] },
] as const;

export const tokenRegistryWebAbi = [
  {
    type: "function", name: "getToken", stateMutability: "view", inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "status", type: "uint8" }, { name: "maxTradeAmount", type: "uint96" },
      { name: "maxSlippageBps", type: "uint16" }, { name: "decimals", type: "uint8" }, { name: "exists", type: "bool" },
    ] }],
  },
] as const;
