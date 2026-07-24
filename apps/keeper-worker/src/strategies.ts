import { strategyCatalogAbi } from "./abi";
import { publicFor } from "./client";
import type { Env } from "./types";

export async function listStrategies(env: Env) {
  const client = publicFor(env);
  const next = Number(await client.readContract({
    address: env.FLOW_STRATEGY_REGISTRY,
    abi: strategyCatalogAbi,
    functionName: "nextStrategyId",
  }));
  const first = Math.max(1, next - 200);
  const output = [];
  for (let id = first; id < next; id += 1) {
    const strategy: any = await client.readContract({
      address: env.FLOW_STRATEGY_REGISTRY,
      abi: strategyCatalogAbi,
      functionName: "getStrategy",
      args: [BigInt(id)],
    });
    const rules = strategy.rules ?? strategy[7];
    const metadataURI = String(strategy.metadataURI ?? strategy[2]);
    const metadataId = metadataURI.includes("/api/v1/strategy-metadata/") ? metadataURI.split("/").pop() : null;
    const metadata = metadataId
      ? await env.DB.prepare("SELECT name,description FROM strategy_metadata WHERE id=?").bind(metadataId).first<{name:string;description:string}>()
      : null;
    const officialNames: Record<number,string> = {1:"Flow Reserve",2:"Balanced Rotation",3:"Active Momentum"};
    output.push({
      id,
      name: metadata?.name || officialNames[id] || `Creator Strategy #${id}`,
      description: metadata?.description || "Reviewed deterministic on-chain strategy rules.",
      creator: strategy.creator ?? strategy[0],
      payout: strategy.payout ?? strategy[1],
      metadataURI,
      rulesHash: strategy.rulesHash ?? strategy[3],
      creatorFeeBps: Number(strategy.creatorFeeBps ?? strategy[4]),
      minimumTier: Number(strategy.minimumTier ?? strategy[5]),
      active: Boolean(strategy.active ?? strategy[6]),
      rules: {
        reserveBps: Number(rules.reserveBps ?? rules[0]),
        rebalanceThresholdBps: Number(rules.rebalanceThresholdBps ?? rules[1]),
        maxTradeUsd: Number(rules.maxTradeUsdE6 ?? rules[2]) / 1_000_000,
        maxAssets: Number(rules.maxAssets ?? rules[3]),
        momentumOnly: Boolean(rules.momentumOnly ?? rules[4]),
        cooldownSeconds: Number(rules.cooldownSeconds ?? rules[5]),
        maxTradesPerDay: Number(rules.maxTradesPerDay ?? rules[6]),
      },
    });
  }
  return output;
}
