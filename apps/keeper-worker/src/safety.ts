import { getAddress, type Address } from "viem";
import { factoryAbi, routerAbi } from "./abi";
import { publicFor } from "./client";
import type { Env } from "./types";

export async function verifyRuntime(env: Env) {
  const client = publicFor(env);
  const chainId = await client.getChainId();
  if (chainId !== 327 || Number(env.CHAIN_ID) !== 327) throw new Error(`CHAIN_MISMATCH:${chainId}`);

  const dependencies = {
    factory: env.V2_FACTORY,
    router: env.V2_ROUTER,
    WXCN: env.WXCN,
    WETH: env.WETH,
    USDC: env.USDC,
    vaultFactory: env.FLOW_VAULT_FACTORY,
    executionRouter: env.FLOW_EXECUTION_ROUTER,
    adapter: env.FLOW_ADAPTER,
    tokenRegistry: env.FLOW_TOKEN_REGISTRY,
    strategyRegistry: env.FLOW_STRATEGY_REGISTRY,
    tierManager: env.FLOW_TIER_MANAGER,
  };
  for (const [name, address] of Object.entries(dependencies)) {
    if (!address || !await client.getBytecode({ address: address as Address })) throw new Error(`NO_CODE:${name}`);
  }

  const factory = await client.readContract({ address: env.V2_ROUTER, abi: routerAbi, functionName: "factory" });
  if (getAddress(factory) !== getAddress(env.V2_FACTORY)) throw new Error("ROUTER_FACTORY_MISMATCH");
  for (const [tokenA, tokenB, expectedPair] of [
    [env.WXCN, env.USDC, env.XCN_USDC_PAIR],
    [env.WETH, env.USDC, env.WETH_USDC_PAIR],
  ] as const) {
    const actual = await client.readContract({
      address: env.V2_FACTORY, abi: factoryAbi, functionName: "getPair", args: [tokenA, tokenB],
    });
    if (getAddress(actual) !== getAddress(expectedPair)) throw new Error("PAIR_MISMATCH");
  }
  return { chainId, block: await client.getBlockNumber() };
}

export async function executionAllowed(env: Env) {
  if (env.LIVE_EXECUTION !== "true") return false;
  const row = await env.DB.prepare("SELECT value FROM system_state WHERE key='execution_paused'")
    .first<{ value: string }>();
  return row?.value === "false";
}

export async function acquireLease(env: Env, name: string, holder: string, seconds = 300) {
  const now = Math.floor(Date.now() / 1000);
  const expires = now + seconds;
  await env.DB.prepare("DELETE FROM leases WHERE name=? AND expires_at<?").bind(name, now).run();
  const result = await env.DB.prepare("INSERT OR IGNORE INTO leases(name,holder,expires_at) VALUES(?,?,?)")
    .bind(name, holder, expires).run();
  return result.meta.changes === 1;
}

export async function releaseLease(env: Env, name: string, holder: string) {
  await env.DB.prepare("DELETE FROM leases WHERE name=? AND holder=?").bind(name, holder).run();
}
