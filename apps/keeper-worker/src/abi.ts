export const factoryAbi = [
  {
    type: "function", name: "getPair", stateMutability: "view",
    inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }],
    outputs: [{ name: "pair", type: "address" }],
  },
  {
    type: "function", name: "allPairsLength", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "allPairs", stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }], outputs: [{ name: "pair", type: "address" }],
  },
] as const;

export const routerAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "function", name: "getAmountsOut", stateMutability: "view",
    inputs: [{ name: "amountIn", type: "uint256" }, { name: "path", type: "address[]" }],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

export const pairAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "function", name: "getReserves", stateMutability: "view", inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
] as const;

export const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  {
    type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const tokenRegistryAbi = [
  {
    type: "function", name: "getToken", stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{
      name: "", type: "tuple", components: [
        { name: "status", type: "uint8" },
        { name: "maxTradeAmount", type: "uint96" },
        { name: "maxSlippageBps", type: "uint16" },
        { name: "decimals", type: "uint8" },
        { name: "exists", type: "bool" },
      ],
    }],
  },
] as const;

export const vaultAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "automationArmed", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "executor", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "executorExpiry", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "tokenAllowed", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "maxTradeAmount", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "strategyAllowed", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  {
    type: "function", name: "executeSwap", stateMutability: "nonpayable",
    inputs: [
      { name: "adapter", type: "address" }, { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" }, { name: "strategyId", type: "uint256" },
      { name: "referrer", type: "address" }, { name: "adapterData", type: "bytes" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

export const vaultFactoryAbi = [
  { type: "function", name: "isVault", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "ownerOfVault", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "address" }] },
] as const;

export const strategyRegistryAbi = [
  { type: "function", name: "isActive", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "minimumTier", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ name: "", type: "uint8" }] },
  {
    type: "function", name: "getRules", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "reserveBps", type: "uint16" },
      { name: "rebalanceThresholdBps", type: "uint16" },
      { name: "maxTradeUsdE6", type: "uint64" },
      { name: "maxAssets", type: "uint8" },
      { name: "momentumOnly", type: "bool" },
      { name: "cooldownSeconds", type: "uint32" },
      { name: "maxTradesPerDay", type: "uint16" },
    ] }],
  },
] as const;

export const strategyCatalogAbi = [
  { type: "function", name: "nextStrategyId", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function", name: "getStrategy", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "creator", type: "address" },
      { name: "payout", type: "address" },
      { name: "metadataURI", type: "string" },
      { name: "rulesHash", type: "bytes32" },
      { name: "creatorFeeBps", type: "uint16" },
      { name: "minimumTier", type: "uint8" },
      { name: "active", type: "bool" },
      { name: "rules", type: "tuple", components: [
        { name: "reserveBps", type: "uint16" },
        { name: "rebalanceThresholdBps", type: "uint16" },
        { name: "maxTradeUsdE6", type: "uint64" },
        { name: "maxAssets", type: "uint8" },
        { name: "momentumOnly", type: "bool" },
        { name: "cooldownSeconds", type: "uint32" },
        { name: "maxTradesPerDay", type: "uint16" },
      ] },
    ] }],
  },
] as const;


export const tierManagerAbi = [
  {
    type: "function", name: "tierOf", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint8" }],
  },
] as const;


export const executionRouterViewAbi = [
  {
    type: "function", name: "tierFeeBps", stateMutability: "view",
    inputs: [{ name: "tier", type: "uint8" }], outputs: [{ name: "", type: "uint16" }],
  },
] as const;
