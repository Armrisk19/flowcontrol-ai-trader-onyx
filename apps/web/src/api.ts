const base = (import.meta.env.VITE_KEEPER_API_URL || "").replace(/\/$/, "");

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (!base) throw new Error("Keeper API is not configured.");
  const response = await fetch(base + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `API ${response.status}`);
  return body as T;
}

export type Market = {
  pair: string; pairAddress: string; token0: string; token1: string;
  symbol0: string; symbol1: string; decimals0: number; decimals1: number;
  status: "ACTIVE" | "LIMITED" | "WATCHLIST" | "PAUSED";
  liquidityUsd: number; safeTradeUsd: number; roundTripCostBps: number;
  assetUsdcPrice: number; reviewed: boolean; registryApproved: boolean;
  official: boolean; updatedAt: string;
};

export type StrategyRules = {
  reserveBps: number;
  rebalanceThresholdBps: number;
  maxTradeUsd: number;
  maxAssets: number;
  momentumOnly: boolean;
  cooldownSeconds: number;
  maxTradesPerDay: number;
};

export type CatalogStrategy = {
  id: number; name: string; description: string; creator: string; payout: string;
  metadataURI: string; rulesHash: string; creatorFeeBps: number; minimumTier: number;
  active: boolean; rules: StrategyRules;
};

export const getMarkets = () => api<{ markets: Market[] }>("/api/v1/markets");
export const getHealth = () => api<any>("/api/v1/health");
export const getStrategies = () => api<{ strategies: CatalogStrategy[] }>("/api/v1/strategies");
