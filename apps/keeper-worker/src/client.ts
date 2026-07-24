import { createPublicClient, createWalletClient, defineChain, fallback, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Env } from "./types";

export const chain = defineChain({
  id: 327,
  name: "Onyx",
  nativeCurrency: { name: "Onyxcoin", symbol: "XCN", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.onyx.org"] } },
});

function rpcTransport(env: Env) {
  const transports = [http(env.ONYX_RPC_URL, { timeout: 12_000, retryCount: 2 })];
  if (env.ONYX_RPC_FALLBACK_URL) {
    transports.push(http(env.ONYX_RPC_FALLBACK_URL, { timeout: 12_000, retryCount: 2 }));
  }
  return fallback(transports);
}

export const publicFor = (env: Env) => createPublicClient({ chain, transport: rpcTransport(env) });

export function signerFor(env: Env) {
  if (!env.EXECUTOR_PRIVATE_KEY) throw new Error("EXECUTOR_PRIVATE_KEY missing");
  const account = privateKeyToAccount(env.EXECUTOR_PRIVATE_KEY);
  return {
    account,
    wallet: createWalletClient({ account, chain, transport: rpcTransport(env) }),
  };
}
