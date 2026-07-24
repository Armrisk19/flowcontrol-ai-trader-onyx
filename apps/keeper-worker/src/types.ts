export interface Env {
  DB: D1Database;
  ONYX_RPC_URL: string;
  ONYX_RPC_FALLBACK_URL?: string;
  CHAIN_ID: string;
  V2_FACTORY: `0x${string}`;
  V2_ROUTER: `0x${string}`;
  WXCN: `0x${string}`;
  WETH: `0x${string}`;
  USDC: `0x${string}`;
  XCN_USDC_PAIR: `0x${string}`;
  WETH_USDC_PAIR: `0x${string}`;
  FLOW_VAULT_FACTORY: `0x${string}`;
  FLOW_EXECUTION_ROUTER: `0x${string}`;
  FLOW_ADAPTER: `0x${string}`;
  FLOW_TOKEN_REGISTRY: `0x${string}`;
  FLOW_STRATEGY_REGISTRY: `0x${string}`;
  FLOW_TIER_MANAGER: `0x${string}`;
  EXECUTOR_PRIVATE_KEY?: `0x${string}`;
  ADMIN_API_KEY?: string;
  ALLOWED_WEB_ORIGIN: string;
  LIVE_EXECUTION: string;
  MAX_EXECUTIONS_PER_CYCLE: string;
  MIN_MARKET_OBSERVATION_MINUTES: string;
  MAX_PAIR_DISCOVERY_PER_CYCLE: string;
  MAX_MARKET_ASSESS_PER_CYCLE: string;
  MAX_VAULTS_PER_CYCLE: string;
}

export type MarketStatus = "ACTIVE" | "LIMITED" | "WATCHLIST" | "PAUSED";

export interface MarketRow {
  pair_address: string;
  token0: string;
  token1: string;
  symbol0: string;
  symbol1: string;
  decimals0: number;
  decimals1: number;
  status: MarketStatus;
  liquidity_usd: number;
  safe_trade_usd: number;
  round_trip_cost_bps: number;
  asset_usdc_price: number;
  updated_at: string;
  reviewed: number;
  registry_approved: number;
  official: number;
}
