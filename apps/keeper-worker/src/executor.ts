import { encodeAbiParameters, formatUnits, getAddress, parseUnits, type Address } from "viem";
import { erc20Abi, executionRouterViewAbi, routerAbi, strategyRegistryAbi, tierManagerAbi, tokenRegistryAbi, vaultAbi } from "./abi";
import { publicFor, signerFor } from "./client";
import { executionAllowed } from "./safety";
import { buildDynamicWeights, chooseRebalance, type StrategyConfig } from "./strategy";
import type { Env, MarketRow } from "./types";

interface Asset {
  key: string;
  address: Address;
  symbol: string;
  decimals: number;
  price: number;
  safeTradeUsd: number;
  quality: number;
  momentum: number;
}

function amountForUsd(usd: number, price: number, decimals: number): bigint {
  const units = usd / price;
  return parseUnits(units.toFixed(Math.max(0, Math.min(decimals, 12))), decimals);
}

async function eligibleAssets(env: Env, vault: Address): Promise<Asset[]> {
  const client = publicFor(env);
  const rows = (await env.DB.prepare(`
    SELECT * FROM markets
    WHERE status IN ('ACTIVE','LIMITED') AND reviewed=1 AND registry_approved=1
      AND last_assessed_at>=datetime('now','-10 minutes')
      AND (lower(token0)=lower(?) OR lower(token1)=lower(?))
    ORDER BY safe_trade_usd DESC, liquidity_usd DESC
  `).bind(env.USDC, env.USDC).all<MarketRow>()).results;

  const byAddress = new Map<string, Asset>();
  for (const row of rows) {
    const token0IsUsdc = row.token0.toLowerCase() === env.USDC.toLowerCase();
    const address = getAddress(token0IsUsdc ? row.token1 : row.token0);
    const symbol = token0IsUsdc ? row.symbol1 : row.symbol0;
    const decimals = token0IsUsdc ? row.decimals1 : row.decimals0;
    const allowed = await client.readContract({ address: vault, abi: vaultAbi, functionName: "tokenAllowed", args: [address] });
    if (!allowed || row.asset_usdc_price <= 0) continue;

    const previous = await env.DB.prepare(`
      SELECT price FROM price_samples
      WHERE pair_address=? AND created_at<=datetime('now','-60 minutes')
      ORDER BY created_at DESC LIMIT 1
    `).bind(row.pair_address).first<{ price: number }>();
    const momentum = previous?.price > 0 ? row.asset_usdc_price / previous.price - 1 : 0;
    const quality = (row.status === "ACTIVE" ? 3 : 1.5)
      + Math.min(2, Math.log10(Math.max(10_000, row.liquidity_usd)) / 3)
      + Math.min(1, row.safe_trade_usd / 5_000);
    const key = address.toLowerCase();
    const candidate: Asset = {
      key, address, symbol, decimals, price: row.asset_usdc_price,
      safeTradeUsd: row.safe_trade_usd, quality, momentum,
    };
    const existing = byAddress.get(key);
    if (!existing || candidate.safeTradeUsd > existing.safeTradeUsd) byAddress.set(key, candidate);
  }
  return [...byAddress.values()];
}


async function loadStrategy(env: Env, strategyId: number): Promise<StrategyConfig> {
  const client = publicFor(env);
  const active = await client.readContract({
    address: env.FLOW_STRATEGY_REGISTRY,
    abi: strategyRegistryAbi,
    functionName: "isActive",
    args: [BigInt(strategyId)],
  });
  if (!active) throw new Error("STRATEGY_INACTIVE");
  const rules: any = await client.readContract({
    address: env.FLOW_STRATEGY_REGISTRY,
    abi: strategyRegistryAbi,
    functionName: "getRules",
    args: [BigInt(strategyId)],
  });
  return {
    reserveBps: Number(rules.reserveBps ?? rules[0]),
    thresholdBps: Number(rules.rebalanceThresholdBps ?? rules[1]),
    maxTradeUsd: Number(rules.maxTradeUsdE6 ?? rules[2]) / 1_000_000,
    maxAssets: Number(rules.maxAssets ?? rules[3]),
    momentumOnly: Boolean(rules.momentumOnly ?? rules[4]),
    cooldownSeconds: Number(rules.cooldownSeconds ?? rules[5]),
    maxTradesPerDay: Number(rules.maxTradesPerDay ?? rules[6]),
  };
}

export async function runVaults(env: Env, cycleId: string) {
  const live = await executionAllowed(env);
  const vaultLimit = Math.max(1, Math.min(Number(env.MAX_VAULTS_PER_CYCLE || 50), 500));
  const rows = (await env.DB.prepare("SELECT * FROM vaults WHERE enabled=1 AND expires_at>? ORDER BY last_checked_at ASC LIMIT ?")
    .bind(Math.floor(Date.now() / 1000), vaultLimit).all<any>()).results;
  let executed = 0;

  for (const row of rows) {
    if (executed >= Number(env.MAX_EXECUTIONS_PER_CYCLE || 3)) break;
    try {
      const client = publicFor(env);
      const vault = getAddress(row.vault);
      const [paused, armed, executor, expiry, vaultOwner] = await Promise.all([
        client.readContract({ address: vault, abi: vaultAbi, functionName: "paused" }),
        client.readContract({ address: vault, abi: vaultAbi, functionName: "automationArmed" }),
        client.readContract({ address: vault, abi: vaultAbi, functionName: "executor" }),
        client.readContract({ address: vault, abi: vaultAbi, functionName: "executorExpiry" }),
        client.readContract({ address: vault, abi: vaultAbi, functionName: "owner" }),
      ]);
      const signer = env.EXECUTOR_PRIVATE_KEY ? signerFor(env) : null;
      const executorMismatch = signer && getAddress(executor) !== getAddress(signer.account.address);
      if (paused || !armed || Number(expiry) <= Date.now() / 1000 || executorMismatch || (live && !signer)) {
        await log(env, row.vault, cycleId, live ? "LIVE" : "SHADOW", "NONE", null,
          "Vault is paused, unarmed, expired, assigned to another executor, or missing the live signer");
        continue;
      }

      const usdcAllowed = await client.readContract({
        address: vault, abi: vaultAbi, functionName: "tokenAllowed", args: [env.USDC],
      });
      if (!usdcAllowed) {
        await log(env, row.vault, cycleId, live ? "LIVE" : "SHADOW", "NONE", null, "USDC policy is not enabled");
        continue;
      }

      const assets = await eligibleAssets(env, vault);
      const values: Record<string, number> = {};
      const assetByKey = new Map<string, Asset>();
      for (const asset of assets) {
        assetByKey.set(asset.key, asset);
        const balance = await client.readContract({
          address: asset.address, abi: erc20Abi, functionName: "balanceOf", args: [vault],
        });
        values[asset.key] = Number(formatUnits(balance, asset.decimals)) * asset.price;
      }
      const usdcBalance = await client.readContract({
        address: env.USDC, abi: erc20Abi, functionName: "balanceOf", args: [vault],
      });
      values.USDC = Number(formatUnits(usdcBalance, 6));

      const strategyId = Number(row.strategy_id);
      const strategyConfig = await loadStrategy(env, strategyId);
      const targetWeights = buildDynamicWeights(assets, strategyConfig);
      const choice = chooseRebalance(values, strategyConfig, targetWeights);
      if (!choice) {
        await log(env, row.vault, cycleId, live ? "LIVE" : "SHADOW", "NONE", null,
          "Portfolio is inside the strategy threshold or no eligible momentum market is available");
        continue;
      }

      const tokenIn: Asset = choice.sell === "USDC"
        ? { key: "USDC", address: env.USDC, symbol: "USDC", decimals: 6, price: 1, safeTradeUsd: Infinity, quality: 0, momentum: 0 }
        : assetByKey.get(choice.sell)!;
      const tokenOut: Asset = choice.buy === "USDC"
        ? { key: "USDC", address: env.USDC, symbol: "USDC", decimals: 6, price: 1, safeTradeUsd: Infinity, quality: 0, momentum: 0 }
        : assetByKey.get(choice.buy)!;
      if (!tokenIn || !tokenOut) throw new Error("TARGET_ASSET_UNAVAILABLE");

      const safeUsd = Math.min(choice.usd, strategyConfig.maxTradeUsd, tokenIn.safeTradeUsd, tokenOut.safeTradeUsd);
      if (safeUsd < 5) {
        await log(env, row.vault, cycleId, live ? "LIVE" : "SHADOW", "NONE", null, "Liquidity-safe trade size is below $5");
        continue;
      }
      let amountIn = amountForUsd(safeUsd, tokenIn.price, tokenIn.decimals);
      const vaultCap = await client.readContract({
        address: vault, abi: vaultAbi, functionName: "maxTradeAmount", args: [tokenIn.address],
      });
      if (amountIn > vaultCap) amountIn = vaultCap;
      const actualUsd = Number(formatUnits(amountIn, tokenIn.decimals)) * tokenIn.price;
      if (amountIn <= 0n || actualUsd < 5) {
        await log(env, row.vault, cycleId, live ? "LIVE" : "SHADOW", "NONE", null,
          "Vault trade cap reduces the executable order below $5");
        continue;
      }

      const path: Address[] = tokenIn.address.toLowerCase() === env.USDC.toLowerCase()
        || tokenOut.address.toLowerCase() === env.USDC.toLowerCase()
        ? [tokenIn.address, tokenOut.address]
        : [tokenIn.address, env.USDC, tokenOut.address];
      const [ownerTier, inputConfig, outputConfig] = await Promise.all([
        client.readContract({ address: env.FLOW_TIER_MANAGER, abi: tierManagerAbi, functionName: "tierOf", args: [vaultOwner] }),
        client.readContract({ address: env.FLOW_TOKEN_REGISTRY, abi: tokenRegistryAbi, functionName: "getToken", args: [tokenIn.address] }),
        client.readContract({ address: env.FLOW_TOKEN_REGISTRY, abi: tokenRegistryAbi, functionName: "getToken", args: [tokenOut.address] }),
      ]);
      const feeBps = await client.readContract({
        address: env.FLOW_EXECUTION_ROUTER, abi: executionRouterViewAbi, functionName: "tierFeeBps", args: [ownerTier],
      });
      const netAmountIn = amountIn * BigInt(10_000 - Number(feeBps)) / 10_000n;
      const quote = await client.readContract({
        address: env.V2_ROUTER, abi: routerAbi, functionName: "getAmountsOut", args: [netAmountIn, path],
      });
      const inputSlip = Number((inputConfig as any).maxSlippageBps ?? (inputConfig as any)[2]);
      const outputSlip = Number((outputConfig as any).maxSlippageBps ?? (outputConfig as any)[2]);
      const slippageBps = Math.max(0, Math.min(100, inputSlip, outputSlip));
      const minimumOut = quote[quote.length - 1] * BigInt(10_000 - slippageBps) / 10_000n;
      const adapterData = encodeAbiParameters([{ type: "address[]" }], [path]);
      const decision = {
        tokenIn: tokenIn.address, tokenOut: tokenOut.address, amountIn: String(amountIn),
        minimumOut: String(minimumOut), score: tokenOut.quality + tokenOut.momentum * 25,
      };

      if (!live) {
        await log(env, row.vault, cycleId, "SHADOW", "REBALANCE", decision,
          `${choice.reason}; route ${tokenIn.symbol} → ${tokenOut.symbol}`);
        continue;
      }

      const simulation = await client.simulateContract({
        account: signer!.account,
        address: vault,
        abi: vaultAbi,
        functionName: "executeSwap",
        args: [
          env.FLOW_ADAPTER, tokenIn.address, tokenOut.address, amountIn, minimumOut,
          BigInt(strategyId), row.referrer as Address, adapterData,
        ],
      });
      const hash = await signer!.wallet.writeContract(simulation.request);
      await client.waitForTransactionReceipt({ hash, confirmations: 2 });
      await log(env, row.vault, cycleId, "LIVE", "REBALANCE", { ...decision, txHash: hash },
        `${choice.reason}; route ${tokenIn.symbol} → ${tokenOut.symbol}`);
      executed += 1;
    } catch (error) {
      await log(env, row.vault, cycleId, live ? "LIVE" : "SHADOW", "ERROR", null,
        error instanceof Error ? error.message : String(error));
    } finally {
      await env.DB.prepare("UPDATE vaults SET last_checked_at=datetime('now'),updated_at=datetime('now') WHERE vault=?")
        .bind(row.vault).run();
    }
  }
  return { vaults: rows.length, executed, live };
}

async function log(env: Env, vault: string, cycle: string, mode: string, action: string, execution: any, reason: string) {
  await env.DB.prepare(`
    INSERT INTO decisions(vault,cycle_id,mode,action,token_in,token_out,amount_in,minimum_out,score,reason,tx_hash,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
  `).bind(
    vault, cycle, mode, action, execution?.tokenIn || null, execution?.tokenOut || null,
    execution?.amountIn || null, execution?.minimumOut || null, execution?.score || null,
    reason, execution?.txHash || null,
  ).run();
}
