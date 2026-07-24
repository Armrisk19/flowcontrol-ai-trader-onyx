import { describe, expect, it } from "vitest";
import { buildDynamicWeights, chooseRebalance, type StrategyConfig } from "../src/strategy";

const balanced: StrategyConfig = {
  reserveBps: 4500, thresholdBps: 700, maxTradeUsd: 250, maxAssets: 4,
  momentumOnly: false, cooldownSeconds: 7200, maxTradesPerDay: 6,
};

describe("dynamic strategy", () => {
  it("allocates every selected market inside the non-USDC budget", () => {
    const weights = buildDynamicWeights([
      { key: "A", quality: 4, momentum: 0.02 },
      { key: "B", quality: 3, momentum: -0.01 },
    ], balanced);
    expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(weights.USDC).toBe(4_500);
  });

  it("chooses a bounded rebalance", () => {
    const weights = { USDC: 4500, A: 3500, B: 2000 };
    const choice = chooseRebalance({ USDC: 90, A: 5, B: 5 }, balanced, weights);
    expect(choice?.sell).toBe("USDC");
    expect(choice?.buy).toBe("A");
    expect(choice!.usd).toBeLessThanOrEqual(250);
  });
});
