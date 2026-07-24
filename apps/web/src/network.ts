import { createPublicClient, createWalletClient, custom, defineChain, fallback, getAddress, http, isAddress, type Address } from "viem";

export const ADDR = {
  factory: "0x008c99EedA17E193e5F788536234C6b3520B8D15",
  router: "0xa973c5626eEaF7F482439753953e9B28C6aF3674",
  WXCN: "0x1a0Da75ADf091a69E7285e596bB27218D77E17a9",
  WETH: "0x9253587505c3B7E7b9DEE118AE1AcB53eEC0E4b6",
  USDC: "0xC8410270bb53f6c99A2EFe6eD3686a8630Efe22B",
} as const;

export const onyx = defineChain({
  id: 327,
  name: "Onyx",
  nativeCurrency: { name: "Onyxcoin", symbol: "XCN", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_ONYX_RPC_URL || "https://rpc.onyx.org"] } },
  blockExplorers: { default: { name: "Onyx Explorer", url: import.meta.env.VITE_ONYX_EXPLORER_URL || "https://explorer.onyx.org" } },
});

const webTransports = [http(import.meta.env.VITE_ONYX_RPC_URL || "https://rpc.onyx.org")];
if (import.meta.env.VITE_ONYX_RPC_FALLBACK_URL) webTransports.push(http(import.meta.env.VITE_ONYX_RPC_FALLBACK_URL));
export const publicClient = createPublicClient({ chain: onyx, transport: fallback(webTransports) });

export async function connectWallet() {
  if (!window.ethereum) throw new Error("Install an EVM wallet such as Coinbase Wallet or MetaMask.");
  await window.ethereum.request({
    method: "wallet_addEthereumChain",
    params: [{
      chainId: "0x147",
      chainName: "Onyx",
      nativeCurrency: { name: "Onyxcoin", symbol: "XCN", decimals: 18 },
      rpcUrls: [import.meta.env.VITE_ONYX_RPC_URL || "https://rpc.onyx.org"],
      blockExplorerUrls: [import.meta.env.VITE_ONYX_EXPLORER_URL || "https://explorer.onyx.org"],
    }],
  });
  const client = createWalletClient({ chain: onyx, transport: custom(window.ethereum) });
  const [account] = await client.requestAddresses();
  const chainId = await client.getChainId();
  if (chainId !== 327) throw new Error(`Wrong network ${chainId}; switch to Onyx 327.`);
  return { client, account: getAddress(account) };
}

export async function verifyLiveDependencies() {
  const chainId = await publicClient.getChainId();
  if (chainId !== 327) throw new Error(`RPC returned chain ${chainId}, expected 327.`);

  const deployed = {
    vaultFactory: import.meta.env.VITE_FLOW_VAULT_FACTORY,
    executionRouter: import.meta.env.VITE_FLOW_EXECUTION_ROUTER,
    adapter: import.meta.env.VITE_FLOW_ADAPTER,
    tokenRegistry: import.meta.env.VITE_FLOW_TOKEN_REGISTRY,
    strategyRegistry: import.meta.env.VITE_FLOW_STRATEGY_REGISTRY,
    tierManager: import.meta.env.VITE_FLOW_TIER_MANAGER,
    membership: import.meta.env.VITE_FLOW_MEMBERSHIP,
  };
  for (const [name, address] of Object.entries({ ...ADDR, ...deployed })) {
    if (!address || !isAddress(address)) throw new Error(`${name} address is not configured.`);
    const code = await publicClient.getBytecode({ address: address as Address });
    if (!code) throw new Error(`${name} address has no contract code.`);
  }
  return true;
}
