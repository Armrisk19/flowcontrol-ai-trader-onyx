import { formatUnits, getAddress, parseUnits, type Address } from "viem";
import { erc20Abi, factoryAbi, pairAbi, routerAbi, tokenRegistryAbi } from "./abi";
import { publicFor } from "./client";
import type { Env, MarketRow, MarketStatus } from "./types";

const ZERO = "0x0000000000000000000000000000000000000000";
const USD_TIERS = [25, 100, 500, 1_000, 5_000, 10_000, 25_000, 50_000] as const;

async function tokenMeta(env: Env, token: Address) {
  const client = publicFor(env);
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => "UNKNOWN"),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
  ]);
  return { symbol: String(symbol).slice(0, 20), decimals: Number(decimals) };
}

async function upsertPair(env: Env, pair: Address, official: boolean) {
  const client = publicFor(env);
  const [token0, token1] = await Promise.all([
    client.readContract({ address: pair, abi: pairAbi, functionName: "token0" }),
    client.readContract({ address: pair, abi: pairAbi, functionName: "token1" }),
  ]);
  const [meta0, meta1] = await Promise.all([tokenMeta(env, token0), tokenMeta(env, token1)]);

  await env.DB.prepare(`
    INSERT INTO markets(
      pair_address,token0,token1,symbol0,symbol1,decimals0,decimals1,status,
      discovered_at,observed_since,updated_at,reviewed,registry_approved,official
    ) VALUES(?,?,?,?,?,?,?,'WATCHLIST',datetime('now'),datetime('now'),datetime('now'),?,?,?)
    ON CONFLICT(pair_address) DO UPDATE SET
      token0=excluded.token0, token1=excluded.token1, symbol0=excluded.symbol0,
      symbol1=excluded.symbol1, decimals0=excluded.decimals0, decimals1=excluded.decimals1,
      reviewed=MAX(markets.reviewed,excluded.reviewed), official=MAX(markets.official,excluded.official),
      updated_at=datetime('now')
  `).bind(
    pair.toLowerCase(), token0.toLowerCase(), token1.toLowerCase(),
    meta0.symbol, meta1.symbol, meta0.decimals, meta1.decimals,
    official ? 1 : 0, 0, official ? 1 : 0,
  ).run();
}

export async function seedOfficialMarkets(env: Env) {
  await upsertPair(env, getAddress(env.XCN_USDC_PAIR), true);
  await upsertPair(env, getAddress(env.WETH_USDC_PAIR), true);
}

/** Enumerates the factory's complete pair registry, including pairs created long before deployment. */
export async function discoverPairs(env: Env) {
  const client = publicFor(env);
  const total = Number(await client.readContract({
    address: env.V2_FACTORY, abi: factoryAbi, functionName: "allPairsLength",
  }));
  const state = await env.DB.prepare("SELECT last_pair_index FROM scan_state WHERE id=1")
    .first<{ last_pair_index: number }>();
  const start = Math.min(state?.last_pair_index || 0, total);
  const batch = Math.max(1, Math.min(Number(env.MAX_PAIR_DISCOVERY_PER_CYCLE || 25), 100));
  const end = Math.min(start + batch, total);

  for (let index = start; index < end; index += 1) {
    const pair = await client.readContract({
      address: env.V2_FACTORY, abi: factoryAbi, functionName: "allPairs", args: [BigInt(index)],
    });
    await upsertPair(env, getAddress(pair), false);
  }

  await env.DB.prepare("UPDATE scan_state SET last_pair_index=?,updated_at=datetime('now') WHERE id=1")
    .bind(end).run();
  return { total, scanned: end - start, nextIndex: end };
}

async function usdcPrice(env: Env, token: Address, decimals: number): Promise<number> {
  if (token.toLowerCase() === env.USDC.toLowerCase()) return 1;
  const client = publicFor(env);
  const pair = await client.readContract({
    address: env.V2_FACTORY, abi: factoryAbi, functionName: "getPair", args: [token, env.USDC],
  });
  if (pair.toLowerCase() === ZERO) return 0;
  try {
    const output = await client.readContract({
      address: env.V2_ROUTER,
      abi: routerAbi,
      functionName: "getAmountsOut",
      args: [10n ** BigInt(decimals), [token, env.USDC]],
    });
    return Number(formatUnits(output[1], 6));
  } catch {
    return 0;
  }
}

async function registryApproved(env: Env, token: Address): Promise<boolean> {
  try {
    const config: any = await publicFor(env).readContract({
      address: env.FLOW_TOKEN_REGISTRY,
      abi: tokenRegistryAbi,
      functionName: "getToken",
      args: [token],
    });
    return Boolean(config.exists ?? config[4]) && [2, 3].includes(Number(config.status ?? config[0]));
  } catch {
    return false;
  }
}

function amountForUsd(usd: number, price: number, decimals: number): bigint {
  const units = usd / price;
  const precision = Math.max(0, Math.min(decimals, 12));
  return parseUnits(units.toFixed(precision), decimals);
}

function compactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 240);
}

async function quoteWithRetry(
  env: Env,
  amountIn: bigint,
  path: readonly Address[],
): Promise<{ amounts: readonly bigint[] | null; error: string }> {
  const client = publicFor(env);
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const amounts = await client.readContract({
        address: env.V2_ROUTER,
        abi: routerAbi,
        functionName: "getAmountsOut",
        args: [amountIn, [...path]],
      });
      if (amounts.length < 2 || amounts[amounts.length - 1] <= 0n) {
        throw new Error("EMPTY_ROUTER_QUOTE");
      }
      return { amounts, error: "" };
    } catch (error) {
      lastError = compactError(error);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
  }

  return { amounts: null, error: lastError || "ROUTER_QUOTE_FAILED" };
}

async function roundTripCapacity(
  env: Env,
  token0: Address,
  token1: Address,
  decimals0: number,
  price0: number,
) {
  if (price0 <= 0) {
    return {
      activeSafe: 0,
      limitedSafe: 0,
      activeCostBps: 99_999,
      limitedCostBps: 99_999,
      quoteError: "INVALID_USDC_PRICE",
    };
  }

  let activeSafe = 0;
  let limitedSafe = 0;
  let activeCostBps = 99_999;
  let limitedCostBps = 99_999;
  let quoteError = "";

  for (const usd of USD_TIERS) {
    const input = amountForUsd(usd, price0, decimals0);
    if (input <= 0n) break;

    const outbound = await quoteWithRetry(env, input, [token0, token1]);
    if (!outbound.amounts) {
      quoteError = `OUTBOUND: ${outbound.error}`;
      break;
    }

    const outputAmount = outbound.amounts[outbound.amounts.length - 1];
    const inbound = await quoteWithRetry(env, outputAmount, [token1, token0]);
    if (!inbound.amounts) {
      quoteError = `RETURN: ${inbound.error}`;
      break;
    }

    const returnedAmount = inbound.amounts[inbound.amounts.length - 1];
    const returned = returnedAmount > input ? input : returnedAmount;
    const cost = Number((input - returned) * 10_000n / input);

    if (cost <= 100) {
      activeSafe = usd;
      activeCostBps = cost;
    }
    if (cost <= 150) {
      limitedSafe = usd;
      limitedCostBps = cost;
    } else {
      break;
    }
  }

  return {
    activeSafe,
    limitedSafe,
    activeCostBps,
    limitedCostBps,
    quoteError,
  };
}

export async function assessMarkets(env: Env) {
  const client = publicFor(env);
  await env.DB.prepare("UPDATE markets SET status='PAUSED' WHERE official=0 AND last_assessed_at<datetime('now','-10 minutes')").run();
  const limit = Math.max(2, Math.min(Number(env.MAX_MARKET_ASSESS_PER_CYCLE || 25), 100));
  const rows = (await env.DB.prepare("SELECT * FROM markets ORDER BY official DESC,last_assessed_at ASC LIMIT ?").bind(limit).all<MarketRow>()).results;
  const block = await client.getBlockNumber();

  for (const row of rows) {
    try {
      const pair = getAddress(row.pair_address);
      const token0 = getAddress(row.token0);
      const token1 = getAddress(row.token1);
      const reserves = await client.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" });
      const [fallbackPrice0, fallbackPrice1, approved0, approved1] = await Promise.all([
        usdcPrice(env, token0, row.decimals0),
        usdcPrice(env, token1, row.decimals1),
        registryApproved(env, token0),
        registryApproved(env, token1),
      ]);
      const amount0 = Number(formatUnits(reserves[0], row.decimals0));
      const amount1 = Number(formatUnits(reserves[1], row.decimals1));
      const token0IsUsdc = token0.toLowerCase() === env.USDC.toLowerCase();
      const token1IsUsdc = token1.toLowerCase() === env.USDC.toLowerCase();
      const price0 = token1IsUsdc && amount0 > 0 ? amount1 / amount0 : fallbackPrice0;
      const price1 = token0IsUsdc && amount1 > 0 ? amount0 / amount1 : fallbackPrice1;

      const liquidity = amount0 * price0 + amount1 * price1;
      const canonicalUsdcPair = token0IsUsdc || token1IsUsdc;
      const capacity = canonicalUsdcPair
        ? await roundTripCapacity(env, token0, token1, row.decimals0, price0)
        : {
            activeSafe: 0,
            limitedSafe: 0,
            activeCostBps: 99_999,
            limitedCostBps: 99_999,
            quoteError: "PAIR_DOES_NOT_USE_CANONICAL_USDC",
          };
      const registryOk = approved0 && approved1;
      const observation = await env.DB.prepare(`
        SELECT (julianday('now')-julianday(observed_since))*1440 AS minutes
        FROM markets WHERE pair_address=?
      `).bind(row.pair_address).first<{ minutes: number }>();
      const oldEnough = row.official === 1
        || Number(observation?.minutes || 0) >= Number(env.MIN_MARKET_OBSERVATION_MINUTES || 1440);

      let status: MarketStatus = "PAUSED";
      let assessmentReason = "ROUND_TRIP_COST_TOO_HIGH";
      let safeTradeUsd = 0;
      let selectedCostBps = 99_999;

      if (!canonicalUsdcPair) {
        assessmentReason = "NON_CANONICAL_USDC_PAIR";
      } else if (liquidity < 10_000) {
        assessmentReason = "LOW_LIQUIDITY";
      } else if (capacity.limitedSafe === 0) {
        assessmentReason = capacity.quoteError
          ? "ROUTER_QUOTE_UNAVAILABLE"
          : "ROUND_TRIP_COST_TOO_HIGH";
      } else if (row.reviewed !== 1) {
        status = "WATCHLIST";
        assessmentReason = "AWAITING_REVIEW";
        safeTradeUsd = capacity.limitedSafe;
        selectedCostBps = capacity.limitedCostBps;
      } else if (!registryOk) {
        status = "WATCHLIST";
        assessmentReason = "TOKEN_REGISTRY_APPROVAL_REQUIRED";
        safeTradeUsd = capacity.limitedSafe;
        selectedCostBps = capacity.limitedCostBps;
      } else if (!oldEnough) {
        status = "WATCHLIST";
        assessmentReason = "OBSERVATION_PERIOD";
        safeTradeUsd = capacity.limitedSafe;
        selectedCostBps = capacity.limitedCostBps;
      } else if (capacity.activeSafe >= 500) {
        status = "ACTIVE";
        assessmentReason = "ACTIVE_COST_TIER";
        safeTradeUsd = capacity.activeSafe;
        selectedCostBps = capacity.activeCostBps;
      } else if (capacity.limitedSafe >= 100) {
        status = "LIMITED";
        assessmentReason = "LIMITED_COST_TIER";
        safeTradeUsd = capacity.limitedSafe;
        selectedCostBps = capacity.limitedCostBps;
      }

      const assetUsdcPrice = token0.toLowerCase() === env.USDC.toLowerCase()
        ? price1
        : token1.toLowerCase() === env.USDC.toLowerCase() ? price0 : 0;

      await env.DB.prepare(`
        UPDATE markets SET status=?,liquidity_usd=?,safe_trade_usd=?,active_safe_trade_usd=?,
          round_trip_cost_bps=?,asset_usdc_price=?,registry_approved=?,assessment_reason=?,
          quote_error=?,last_block=?,updated_at=datetime('now'),last_assessed_at=datetime('now')
        WHERE pair_address=?
      `).bind(
        status, liquidity, safeTradeUsd, capacity.activeSafe, selectedCostBps,
        assetUsdcPrice, registryOk ? 1 : 0, assessmentReason, capacity.quoteError,
        Number(block), row.pair_address,
      ).run();

      if (assetUsdcPrice > 0) {
        await env.DB.prepare(`
          INSERT OR IGNORE INTO price_samples(pair_address,block_number,price,liquidity_usd,created_at)
          VALUES(?,?,?,?,datetime('now'))
        `).bind(row.pair_address, Number(block), assetUsdcPrice, liquidity).run();
      }
    } catch (error) {
      console.error("assess market", row.pair_address, error);
      await env.DB.prepare("UPDATE markets SET status='PAUSED',updated_at=datetime('now'),last_assessed_at=datetime('now') WHERE pair_address=?")
        .bind(row.pair_address).run();
    }
  }
}

export async function reviewMarket(env: Env, pairAddress: string, reviewed: boolean) {
  const row = await env.DB.prepare("SELECT * FROM markets WHERE pair_address=?")
    .bind(pairAddress.toLowerCase()).first<MarketRow>();
  if (!row) throw new Error("MARKET_NOT_FOUND");
  if (reviewed && row.registry_approved !== 1) throw new Error("TOKENS_NOT_APPROVED_ONCHAIN");
  await env.DB.prepare("UPDATE markets SET reviewed=?,updated_at=datetime('now') WHERE pair_address=?")
    .bind(reviewed ? 1 : 0, pairAddress.toLowerCase()).run();
  return { pairAddress: pairAddress.toLowerCase(), reviewed };
}

export async function listMarkets(env: Env) {
  const result = await env.DB.prepare(`
    SELECT * FROM markets
    ORDER BY CASE status WHEN 'ACTIVE' THEN 1 WHEN 'LIMITED' THEN 2 WHEN 'WATCHLIST' THEN 3 ELSE 4 END,
      liquidity_usd DESC
  `).all<MarketRow>();

  return result.results.map((row) => ({
    pair: `${row.symbol0}/${row.symbol1}`,
    pairAddress: row.pair_address,
    token0: row.token0,
    token1: row.token1,
    symbol0: row.symbol0,
    symbol1: row.symbol1,
    decimals0: row.decimals0,
    decimals1: row.decimals1,
    status: row.status,
    liquidityUsd: row.liquidity_usd,
    safeTradeUsd: row.safe_trade_usd,
    activeSafeTradeUsd: row.active_safe_trade_usd,
    roundTripCostBps: Math.round(row.round_trip_cost_bps),
    assetUsdcPrice: row.asset_usdc_price,
    assessmentReason: row.assessment_reason,
    quoteError: row.quote_error || null,
    reviewed: row.reviewed === 1,
    registryApproved: row.registry_approved === 1,
    official: row.official === 1,
    updatedAt: row.updated_at,
  }));
}
