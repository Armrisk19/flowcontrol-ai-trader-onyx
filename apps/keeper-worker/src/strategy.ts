export interface StrategyConfig {
  reserveBps: number;
  thresholdBps: number;
  maxTradeUsd: number;
  maxAssets: number;
  momentumOnly: boolean;
  cooldownSeconds: number;
  maxTradesPerDay: number;
}

export interface RankedAsset {
  key: string;
  quality: number;
  momentum: number;
}

export function buildDynamicWeights(assets: RankedAsset[], config: StrategyConfig): Record<string, number> {
  const eligible = assets
    .filter((asset) => !config.momentumOnly || asset.momentum > 0)
    .map((asset) => ({
      ...asset,
      score: Math.max(0.1, asset.quality + Math.max(-2, Math.min(4, asset.momentum * 25))),
    }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, config.maxAssets);

  const weights: Record<string, number> = { USDC: eligible.length ? config.reserveBps : 10_000 };
  if (!eligible.length) return weights;
  const available = 10_000 - config.reserveBps;
  const totalScore = eligible.reduce((sum, asset) => sum + asset.score, 0);
  let assigned = 0;
  eligible.forEach((asset, index) => {
    const weight = index === eligible.length - 1
      ? available - assigned
      : Math.floor(available * asset.score / totalScore);
    weights[asset.key] = weight;
    assigned += weight;
  });
  return weights;
}

export function chooseRebalance(
  values: Record<string, number>,
  config: StrategyConfig,
  targetWeights: Record<string, number>,
) {
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const keys = new Set([...Object.keys(values), ...Object.keys(targetWeights)]);
  const deltas = [...keys].map((key) => {
    const target = total * (targetWeights[key] || 0) / 10_000;
    const current = values[key] || 0;
    return { key, target, current, delta: target - current };
  });
  const buy = [...deltas].sort((a, b) => b.delta - a.delta)[0];
  const sell = [...deltas].sort((a, b) => a.delta - b.delta)[0];
  if (!buy || !sell) return null;
  if (buy.delta / total * 10_000 < config.thresholdBps) return null;
  if (-sell.delta / total * 10_000 < config.thresholdBps) return null;
  const usd = Math.min(buy.delta, -sell.delta, config.maxTradeUsd);
  if (usd < 5) return null;
  return {
    sell: sell.key,
    buy: buy.key,
    usd,
    reason: `${sell.key} is overweight and ${buy.key} is underweight versus the selected strategy targets`,
  };
}
