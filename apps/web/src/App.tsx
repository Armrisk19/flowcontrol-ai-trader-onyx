import { useEffect, useMemo, useState } from "react";
import {
  decodeEventLog, encodeAbiParameters, formatUnits, getAddress, isAddress, keccak256, parseUnits, toBytes,
  type Address, type Hash, type TransactionReceipt, type WalletClient,
} from "viem";
import { api, getHealth, getMarkets, getStrategies, type CatalogStrategy, type Market, type StrategyRules } from "./api";
import { erc20Abi, executionRouterViewAbi, factoryAbi, membershipAbi, routerAbi, strategyRegistryWebAbi, tierAbi, tokenRegistryWebAbi, vaultAbi } from "./abis";
import { ADDR, connectWallet, onyx, publicClient, verifyLiveDependencies } from "./network";

const ZERO = "0x0000000000000000000000000000000000000000";
const FACTORY = (import.meta.env.VITE_FLOW_VAULT_FACTORY || "") as Address;
const EXECUTION_ROUTER = (import.meta.env.VITE_FLOW_EXECUTION_ROUTER || "") as Address;
const TOKEN_REGISTRY = (import.meta.env.VITE_FLOW_TOKEN_REGISTRY || "") as Address;
const EXECUTOR = (import.meta.env.VITE_KEEPER_EXECUTOR_ADDRESS || "") as Address;
const TIER_MANAGER = (import.meta.env.VITE_FLOW_TIER_MANAGER || "") as Address;
const MEMBERSHIP = (import.meta.env.VITE_FLOW_MEMBERSHIP || "") as Address;
const STRATEGY_REGISTRY = (import.meta.env.VITE_FLOW_STRATEGY_REGISTRY || "") as Address;
const ADAPTER = (import.meta.env.VITE_FLOW_ADAPTER || "") as Address;
const REVIEWER_ROLE = keccak256(toBytes("REVIEWER_ROLE"));
const TIER_NAMES = ["Starter", "Flow", "Pro", "Creator", "Partner"];
const CORE_TOKENS = [
  { symbol: "USDC", address: ADDR.USDC as Address, decimals: 6 },
  { symbol: "WXCN", address: ADDR.WXCN as Address, decimals: 18 },
  { symbol: "WETH", address: ADDR.WETH as Address, decimals: 18 },
];
const FALLBACK_STRATEGIES: CatalogStrategy[] = [
  { id: 1, name: "Flow Reserve", description: "High-reserve allocation across reviewed liquid markets.", creator: ZERO, payout: ZERO, metadataURI: "official:1", rulesHash: "0x", creatorFeeBps: 0, minimumTier: 0, active: true, rules: { reserveBps: 7000, rebalanceThresholdBps: 1000, maxTradeUsd: 100, maxAssets: 2, momentumOnly: false, cooldownSeconds: 21600, maxTradesPerDay: 3 } },
  { id: 2, name: "Balanced Rotation", description: "Balanced rotation across every eligible direct-USDC market.", creator: ZERO, payout: ZERO, metadataURI: "official:2", rulesHash: "0x", creatorFeeBps: 0, minimumTier: 1, active: true, rules: { reserveBps: 4500, rebalanceThresholdBps: 700, maxTradeUsd: 250, maxAssets: 4, momentumOnly: false, cooldownSeconds: 7200, maxTradesPerDay: 6 } },
  { id: 3, name: "Active Momentum", description: "Momentum-filtered allocation with stricter size and frequency caps.", creator: ZERO, payout: ZERO, metadataURI: "official:3", rulesHash: "0x", creatorFeeBps: 0, minimumTier: 2, active: true, rules: { reserveBps: 2500, rebalanceThresholdBps: 500, maxTradeUsd: 500, maxAssets: 6, momentumOnly: true, cooldownSeconds: 1800, maxTradesPerDay: 12 } },
];

type PolicyToken = { symbol: string; address: Address; decimals: number; safeTradeUsd: number };
type CreatorForm = { name: string; description: string; reserveBps: number; rebalanceThresholdBps: number; maxTradeUsd: number; maxAssets: number; momentumOnly: boolean; cooldownSeconds: number; maxTradesPerDay: number };
const initialCreator: CreatorForm = { name: "XCN Trend Rebalance", description: "Maintain a USDC reserve, rotate into reviewed liquid assets when allocations drift, and require positive momentum before entries.", reserveBps: 5000, rebalanceThresholdBps: 700, maxTradeUsd: 250, maxAssets: 4, momentumOnly: true, cooldownSeconds: 7200, maxTradesPerDay: 6 };

function requiredAddress(value: Address, label: string): Address {
  if (!value || !isAddress(value)) throw new Error(`${label} is not configured.`);
  return getAddress(value);
}
function short(value?: string) { return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Connect Wallet"; }
function chunks<T>(items: T[], size: number) { const out: T[][] = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; }
function rulesFromForm(form: CreatorForm): StrategyRules { return { reserveBps: form.reserveBps, rebalanceThresholdBps: form.rebalanceThresholdBps, maxTradeUsd: form.maxTradeUsd, maxAssets: form.maxAssets, momentumOnly: form.momentumOnly, cooldownSeconds: form.cooldownSeconds, maxTradesPerDay: form.maxTradesPerDay }; }

export default function App() {
  const [account, setAccount] = useState<Address>();
  const [wallet, setWallet] = useState<WalletClient>();
  const [vault, setVault] = useState<Address>();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [catalog, setCatalog] = useState<CatalogStrategy[]>(FALLBACK_STRATEGIES);
  const [tab, setTab] = useState("Control");
  const [message, setMessage] = useState("Verifying Onyx and deployed FLOWCONTROL contracts…");
  const [healthy, setHealthy] = useState(false);
  const [health, setHealth] = useState<any>();
  const [armed, setArmed] = useState(false);
  const [strategyId, setStrategyId] = useState(1);
  const [amount, setAmount] = useState("10");
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [tier, setTier] = useState(0);
  const [tierExpiry, setTierExpiry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [isReviewer, setIsReviewer] = useState(false);
  const [creatorForm, setCreatorForm] = useState<CreatorForm>(initialCreator);
  const [swapIn, setSwapIn] = useState<string>(ADDR.USDC);
  const [swapOut, setSwapOut] = useState<string>(ADDR.WXCN);
  const [swapAmount, setSwapAmount] = useState("10");
  const [swapSlippageBps, setSwapSlippageBps] = useState(100);

  async function refreshSystem() {
    try {
      const [, currentHealth, marketData, strategyData] = await Promise.all([
        verifyLiveDependencies(), getHealth(), getMarkets(), getStrategies(),
      ]);
      if (!currentHealth.ok) throw new Error("Keeper health check failed.");
      setHealthy(true); setHealth(currentHealth); setMarkets(marketData.markets);
      setCatalog(strategyData.strategies.length ? strategyData.strategies : FALLBACK_STRATEGIES);
      setMessage("Onyx, deployed contracts, keeper, strategies, and market service verified.");
    } catch (error) {
      setHealthy(false);
      setMessage(`Safety lock: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  useEffect(() => {
    refreshSystem();
    const timer = window.setInterval(refreshSystem, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const rejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || "Unknown error");
      setMessage(`Action stopped safely: ${reason}`);
      setBusy(false);
    };
    const reload = () => window.location.reload();
    window.addEventListener("unhandledrejection", rejection);
    window.ethereum?.on?.("accountsChanged", reload);
    window.ethereum?.on?.("chainChanged", reload);
    return () => window.removeEventListener("unhandledrejection", rejection);
  }, []);

  const activeMarkets = useMemo(() => markets.filter((m) => m.status === "ACTIVE" || m.status === "LIMITED"), [markets]);
  const activeStrategies = useMemo(() => catalog.filter((s) => s.active), [catalog]);
  const selected = useMemo(() => activeStrategies.find((s) => s.id === strategyId) || activeStrategies[0] || FALLBACK_STRATEGIES[0], [activeStrategies, strategyId]);

  async function transact(address: Address, abi: any, functionName: string, args: readonly unknown[] = [], value?: bigint): Promise<TransactionReceipt> {
    if (!wallet || !account) throw new Error("Connect your wallet first.");
    const simulation = await publicClient.simulateContract({ account, address, abi, functionName, args, value } as any);
    const hash = await wallet.writeContract(simulation.request as any) as Hash;
    setMessage(`Transaction submitted after successful simulation: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    setMessage("Transaction confirmed.");
    return receipt;
  }

  async function connect() {
    try {
      setBusy(true);
      const connected = await connectWallet();
      setAccount(connected.account); setWallet(connected.client as WalletClient);
      if (isAddress(FACTORY)) {
        const existing = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "vaultOf", args: [connected.account] });
        if (existing !== ZERO) setVault(getAddress(existing));
      }
      await Promise.all([refreshTier(connected.account), refreshReviewer(connected.account)]);
      setMessage("Wallet connected to verified Onyx mainnet.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function refreshTier(owner = account) {
    if (!owner || !isAddress(TIER_MANAGER)) return;
    const grant = await publicClient.readContract({ address: TIER_MANAGER, abi: tierAbi, functionName: "tierGrant", args: [owner] });
    setTier(Number(grant[0])); setTierExpiry(Number(grant[1]));
  }
  async function refreshReviewer(owner = account) {
    if (!owner || !isAddress(STRATEGY_REGISTRY)) return;
    const reviewer = await publicClient.readContract({ address: STRATEGY_REGISTRY, abi: strategyRegistryWebAbi, functionName: "hasRole", args: [REVIEWER_ROLE, owner] });
    setIsReviewer(Boolean(reviewer));
  }

  async function createVault() {
    setBusy(true);
    try {
      await transact(requiredAddress(FACTORY, "Vault factory"), factoryAbi, "createVault");
      const created = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "vaultOf", args: [account!] });
      setVault(getAddress(created)); setMessage(`Personal vault created: ${created}`);
    } finally { setBusy(false); }
  }

  async function refreshVault() {
    if (!vault) return;
    const entries = await Promise.all(CORE_TOKENS.map(async (token) => {
      const balance = await publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [vault] });
      return [token.symbol, Number(formatUnits(balance, token.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })];
    }));
    setBalances(Object.fromEntries(entries));
    setArmed(Boolean(await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "automationArmed" })));
  }
  useEffect(() => { refreshVault().catch(() => undefined); }, [vault]);

  async function depositUsdc() {
    if (!vault) throw new Error("Create a vault first.");
    setBusy(true); try { await transact(ADDR.USDC as Address, erc20Abi, "transfer", [vault, parseUnits(amount, 6)]); await refreshVault(); } finally { setBusy(false); }
  }
  async function depositXcn() {
    if (!vault) throw new Error("Create a vault first.");
    setBusy(true); try { await transact(vault, vaultAbi, "depositNative", [], parseUnits(amount, 18)); await refreshVault(); } finally { setBusy(false); }
  }
  async function withdrawAll(token: typeof CORE_TOKENS[number]) {
    if (!vault || !account) return;
    const balance = await publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [vault] });
    if (balance === 0n) throw new Error(`No ${token.symbol} balance.`);
    setBusy(true); try { await transact(vault, vaultAbi, "withdraw", [token.address, balance, account]); await refreshVault(); } finally { setBusy(false); }
  }

  function policyUniverse(): PolicyToken[] {
    const byAddress = new Map<string, PolicyToken>();
    byAddress.set(ADDR.USDC.toLowerCase(), { symbol: "USDC", address: ADDR.USDC as Address, decimals: 6, safeTradeUsd: Number.MAX_SAFE_INTEGER });
    for (const market of activeMarkets) {
      const t0Usdc = market.token0.toLowerCase() === ADDR.USDC.toLowerCase();
      const t1Usdc = market.token1.toLowerCase() === ADDR.USDC.toLowerCase();
      if (!t0Usdc && !t1Usdc) continue;
      const token = t0Usdc
        ? { symbol: market.symbol1, address: getAddress(market.token1), decimals: market.decimals1, safeTradeUsd: market.safeTradeUsd }
        : { symbol: market.symbol0, address: getAddress(market.token0), decimals: market.decimals0, safeTradeUsd: market.safeTradeUsd };
      const old = byAddress.get(token.address.toLowerCase());
      if (!old || token.safeTradeUsd > old.safeTradeUsd) byAddress.set(token.address.toLowerCase(), token);
    }
    return [...byAddress.values()].sort((a, b) => b.safeTradeUsd - a.safeTradeUsd);
  }

  async function policyAmounts(tokens: PolicyToken[]) {
    const usdcBalance = vault ? await publicClient.readContract({ address: ADDR.USDC as Address, abi: erc20Abi, functionName: "balanceOf", args: [vault] }) : 0n;
    const addresses: Address[] = [], allowed: boolean[] = []; const perTrade: bigint[] = [], perDay: bigint[] = [], reserve: bigint[] = [];
    for (const token of tokens) {
      const capUsd = token.symbol === "USDC" ? selected.rules.maxTradeUsd : Math.max(5, Math.min(selected.rules.maxTradeUsd, token.safeTradeUsd));
      let cap: bigint;
      if (token.address.toLowerCase() === ADDR.USDC.toLowerCase()) cap = parseUnits(String(capUsd), 6);
      else {
        const quote = await publicClient.readContract({ address: ADDR.router as Address, abi: routerAbi, functionName: "getAmountsOut", args: [parseUnits(String(capUsd), 6), [ADDR.USDC as Address, token.address]] });
        cap = quote[1];
      }
      addresses.push(token.address); allowed.push(true); perTrade.push(cap); perDay.push(cap * BigInt(selected.rules.maxTradesPerDay));
      reserve.push(token.address.toLowerCase() === ADDR.USDC.toLowerCase() ? usdcBalance * BigInt(selected.rules.reserveBps) / 10_000n : 0n);
    }
    return { addresses, allowed, perTrade, perDay, reserve };
  }

  async function registerVault(expiresAt: number) {
    if (!wallet || !account || !vault) throw new Error("Wallet or vault missing.");
    const referrer = ZERO;
    const issuedAt = Math.floor(Date.now() / 1000);
    const signed = `FLOWCONTROL REGISTER\nchainId:327\nowner:${account.toLowerCase()}\nvault:${vault.toLowerCase()}\nstrategyId:${selected.id}\nreferrer:${referrer.toLowerCase()}\nexpiresAt:${expiresAt}\nissuedAt:${issuedAt}`;
    const signature = await wallet.signMessage({ account, message: signed });
    await api("/api/v1/vaults/register", { method: "POST", body: JSON.stringify({ owner: account, vault, strategyId: selected.id, referrer, expiresAt, issuedAt, signature }) });
  }

  async function configureAndArm() {
    if (!healthy) throw new Error("Safety verification has not passed.");
    if (!vault) throw new Error("Create a vault first.");
    requiredAddress(EXECUTOR, "Keeper executor");
    if (tier < selected.minimumTier) throw new Error(`${selected.name} requires the ${TIER_NAMES[selected.minimumTier]} tier.`);
    const universe = policyUniverse();
    if (universe.length < 2) throw new Error("No reviewed liquid market is currently available.");
    setBusy(true);
    try {
      for (const group of chunks(universe, 32)) {
        const policy = await policyAmounts(group);
        await transact(vault, vaultAbi, "setTokenPolicies", [policy.addresses, policy.allowed, policy.perTrade, policy.perDay, policy.reserve]);
      }
      const paused = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "paused" });
      if (paused) await transact(vault, vaultAbi, "unpause");
      const expiresAt = Math.floor(Date.now() / 1000) + 30 * 86400;
      await transact(vault, vaultAbi, "configureAutomation", [BigInt(selected.id), selected.rules.cooldownSeconds, selected.rules.maxTradesPerDay, EXECUTOR, BigInt(expiresAt)]);
      await registerVault(expiresAt); setArmed(true);
      setMessage(`Automation armed and market policies synchronized for ${universe.length - 1} reviewed liquid assets using ${selected.name}.`);
    } finally { setBusy(false); }
  }

  async function pauseAutomation() {
    if (!vault) return;
    setBusy(true); try { await transact(vault, vaultAbi, "pause"); setArmed(false); setMessage("Vault paused. Automated execution is disabled; withdrawals remain owner-controlled."); } finally { setBusy(false); }
  }
  async function disarmAutomation() {
    if (!vault) return;
    setBusy(true); try { await transact(vault, vaultAbi, "setAutomationArmed", [false]); setArmed(false); setMessage("Automated execution disarmed. Owner-initiated manual swaps remain available."); } finally { setBusy(false); }
  }

  async function revokeExecutor() {
    if (!vault) return;
    setBusy(true); try { await transact(vault, vaultAbi, "revokeExecutor"); setArmed(false); setMessage("Executor permission revoked immediately."); } finally { setBusy(false); }
  }

  async function withdrawNativeXcn() {
    if (!vault || !account) return;
    const balance = await publicClient.readContract({ address: ADDR.WXCN as Address, abi: erc20Abi, functionName: "balanceOf", args: [vault] });
    if (balance === 0n) throw new Error("No WXCN balance.");
    setBusy(true); try { await transact(vault, vaultAbi, "withdrawNative", [balance, account]); await refreshVault(); } finally { setBusy(false); }
  }

  async function manualSwap() {
    if (!vault) throw new Error("Create and configure a vault first.");
    const universe = policyUniverse();
    const input = universe.find((token) => token.address.toLowerCase() === swapIn.toLowerCase());
    const output = universe.find((token) => token.address.toLowerCase() === swapOut.toLowerCase());
    if (!input || !output || input.address === output.address) throw new Error("Choose two different eligible tokens.");
    if (swapSlippageBps < 0 || swapSlippageBps > 300) throw new Error("Slippage must be between 0.00% and 3.00%; the registry may enforce a lower route cap.");
    const amountIn = parseUnits(swapAmount, input.decimals);
    const direct = input.address.toLowerCase() === ADDR.USDC.toLowerCase() || output.address.toLowerCase() === ADDR.USDC.toLowerCase();
    const path: Address[] = direct ? [input.address, output.address] : [input.address, ADDR.USDC as Address, output.address];
    const [inputConfig, outputConfig, feeBps] = await Promise.all([
      publicClient.readContract({ address: requiredAddress(TOKEN_REGISTRY, "Token registry"), abi: tokenRegistryWebAbi, functionName: "getToken", args: [input.address] }),
      publicClient.readContract({ address: requiredAddress(TOKEN_REGISTRY, "Token registry"), abi: tokenRegistryWebAbi, functionName: "getToken", args: [output.address] }),
      publicClient.readContract({ address: requiredAddress(EXECUTION_ROUTER, "Execution router"), abi: executionRouterViewAbi, functionName: "tierFeeBps", args: [tier] }),
    ]);
    const registrySlip = Math.min(Number(inputConfig.maxSlippageBps), Number(outputConfig.maxSlippageBps));
    if (swapSlippageBps > registrySlip) throw new Error(`Registry maximum for this route is ${(registrySlip / 100).toFixed(2)}%.`);
    const netAmountIn = amountIn * BigInt(10_000 - Number(feeBps)) / 10_000n;
    const quote = await publicClient.readContract({ address: ADDR.router as Address, abi: routerAbi, functionName: "getAmountsOut", args: [netAmountIn, path] });
    const expected = quote[quote.length - 1];
    const minimumOut = expected * BigInt(10_000 - swapSlippageBps) / 10_000n;
    const adapterData = encodeAbiParameters([{ type: "address[]" }], [path]);
    requiredAddress(ADAPTER, "Onyx adapter");
    setBusy(true);
    try {
      await transact(vault, vaultAbi, "executeSwap", [ADAPTER, input.address, output.address, amountIn, minimumOut, BigInt(selected.id), ZERO, adapterData]);
      await refreshVault();
      setMessage(`Manual swap confirmed. Minimum output protected at ${formatUnits(minimumOut, output.decimals)} ${output.symbol}.`);
    } finally { setBusy(false); }
  }

  async function buyMembership(targetTier: number) {
    requiredAddress(MEMBERSHIP, "Membership contract");
    const plan = await publicClient.readContract({ address: MEMBERSHIP, abi: membershipAbi, functionName: "plans", args: [targetTier] });
    if (!plan[2]) throw new Error("This membership plan is not enabled.");
    setBusy(true); try { await transact(MEMBERSHIP, membershipAbi, "subscribeNative", [targetTier], plan[0]); await refreshTier(); } finally { setBusy(false); }
  }

  async function publishStrategy() {
    if (!wallet || !account) throw new Error("Connect your wallet first.");
    if (tier < 3) throw new Error("Creator tier is required to publish strategies.");
    requiredAddress(STRATEGY_REGISTRY, "Strategy registry");
    const rules = rulesFromForm(creatorForm);
    const metadata = { name: creatorForm.name.trim(), description: creatorForm.description.trim(), rules };
    const canonical = JSON.stringify(metadata);
    const hash = keccak256(toBytes(canonical));
    const signed = `FLOWCONTROL STRATEGY METADATA\nchainId:327\ncreator:${account.toLowerCase()}\nhash:${hash}`;
    setBusy(true);
    try {
      const signature = await wallet.signMessage({ account, message: signed });
      const stored = await api<{ metadataURI: string }>("/api/v1/strategy-metadata", { method: "POST", body: JSON.stringify({ creator: account, metadata, signature }) });
      const tuple = { reserveBps: rules.reserveBps, rebalanceThresholdBps: rules.rebalanceThresholdBps, maxTradeUsdE6: BigInt(Math.round(rules.maxTradeUsd * 1_000_000)), maxAssets: rules.maxAssets, momentumOnly: rules.momentumOnly, cooldownSeconds: rules.cooldownSeconds, maxTradesPerDay: rules.maxTradesPerDay };
      const receipt = await transact(STRATEGY_REGISTRY, strategyRegistryWebAbi, "submitStrategy", [stored.metadataURI, account, tuple]);
      let created = "new";
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: strategyRegistryWebAbi, data: log.data, topics: log.topics });
          if (decoded.eventName === "StrategySubmitted") created = String((decoded.args as any).strategyId);
        } catch { /* another contract event */ }
      }
      await refreshSystem(); setMessage(`Strategy #${created} submitted for reviewer activation.`);
    } finally { setBusy(false); }
  }

  async function reviewStrategy(item: CatalogStrategy, active: boolean) {
    if (!isReviewer) throw new Error("Reviewer role required.");
    setBusy(true);
    try {
      await transact(requiredAddress(STRATEGY_REGISTRY, "Strategy registry"), strategyRegistryWebAbi, "reviewStrategy", [BigInt(item.id), active, active ? 2500 : item.creatorFeeBps, active ? 3 : item.minimumTier]);
      await refreshSystem(); setMessage(`Strategy #${item.id} ${active ? "activated" : "paused"}.`);
    } finally { setBusy(false); }
  }

  const expiryLabel = tierExpiry === Number.MAX_SAFE_INTEGER || tierExpiry > 4_000_000_000 ? "Permanent" : tierExpiry ? new Date(tierExpiry * 1000).toLocaleDateString() : "Starter";
  const pending = catalog.filter((s) => !s.active);

  function controlView() { return <>
    <section className="hero"><div><span className="eyebrow">NON-CUSTODIAL · ONYX · POWERED BY XCN</span><h1>Real automation.<br/><em>Enforced safety.</em> Your funds.</h1><p>Every reviewed direct-USDC Onyx market can join the trading universe after live bidirectional liquidity, round-trip cost, registry, observation, and contract-code checks.</p></div>
      <div className="statusCard"><div className={`pulse ${healthy ? "" : "bad"}`}><i/> {healthy ? "SYSTEM VERIFIED" : "SAFETY LOCKED"}</div><h3>Automation control</h3><label>Strategy<select value={selected.id} onChange={(e) => setStrategyId(Number(e.target.value))}>{activeStrategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><div className="metric"><span>Membership</span><b>{TIER_NAMES[tier]}</b></div><div className="metric"><span>Eligible markets</span><b>{activeMarkets.length}</b></div><div className="metric"><span>Automation</span><b>{armed ? "ARMED" : "OFF"}</b></div>{armed ? <><button disabled={busy} onClick={disarmAutomation}>Disarm automation</button><button className="danger" disabled={busy} onClick={pauseAutomation}>Pause vault immediately</button></> : <button className="primary" disabled={busy || !healthy || !vault} onClick={configureAndArm}>Sync markets & arm</button>}</div>
    </section>
    <section className="stats"><article><span>Vault</span><strong>{vault ? short(vault) : "Not created"}</strong><small>One vault per wallet</small></article><article><span>USDC</span><strong>{balances.USDC || "0"}</strong><small>Vault balance</small></article><article><span>WXCN</span><strong>{balances.WXCN || "0"}</strong><small>Vault balance</small></article><article><span>Execution state</span><strong>{health?.databasePaused ? "Paused" : health?.configuredLive ? "Live gate" : "Shadow gate"}</strong><small>Two independent kill switches</small></article></section>
    <section className="grid"><div className="panel"><div className="panelTitle"><h2>Personal vault</h2><span>{vault || "Create before funding"}</span></div>{!vault && <button className="primary" disabled={busy || !account} onClick={createVault}>Create personal vault</button>}<label>Deposit amount<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"/></label><button disabled={busy || !vault} onClick={depositUsdc}>Deposit USDC</button><button disabled={busy || !vault} onClick={depositXcn}>Deposit native XCN</button><button disabled={busy || !vault} onClick={refreshVault}>Refresh balances</button><div className="two">{CORE_TOKENS.map((t) => <button key={t.symbol} disabled={busy || !vault} onClick={() => withdrawAll(t)}>Withdraw all {t.symbol}</button>)}</div><button disabled={busy || !vault} onClick={withdrawNativeXcn}>Withdraw WXCN as native XCN</button><button className="danger" disabled={busy || !vault} onClick={revokeExecutor}>Revoke executor</button></div>
      <div className="panel"><div className="panelTitle"><h2>Safety envelope</h2><span>Contract enforced</span></div>{["AI cannot withdraw or change recipients","Only reviewed registry tokens","Approved adapter and verified router only","Per-trade and daily spend caps","Minimum USDC reserve","Cooldown and daily trade count","Owner pause and executor expiry","Live execution has two kill switches"].map((x) => <div className="check" key={x}><i>✓</i>{x}</div>)}</div></section>
  </>; }

  function swapView() {
    const tokens = policyUniverse();
    const input = tokens.find((token) => token.address.toLowerCase() === swapIn.toLowerCase());
    const output = tokens.find((token) => token.address.toLowerCase() === swapOut.toLowerCase());
    return <section className="grid"><div className="panel"><div className="panelTitle"><h2>Manual Onyx swap</h2><span>Same router and vault safeguards</span></div><label>Sell<select value={swapIn} onChange={(e) => setSwapIn(e.target.value)}>{tokens.map((token) => <option key={token.address} value={token.address}>{token.symbol}</option>)}</select></label><label>Buy<select value={swapOut} onChange={(e) => setSwapOut(e.target.value)}>{tokens.map((token) => <option key={token.address} value={token.address}>{token.symbol}</option>)}</select></label><label>Amount {input?.symbol || ""}<input value={swapAmount} inputMode="decimal" onChange={(e) => setSwapAmount(e.target.value)}/></label><label>Maximum slippage %<input type="number" min="0" max="3" step="0.1" value={swapSlippageBps / 100} onChange={(e) => setSwapSlippageBps(Math.round(Number(e.target.value) * 100))}/></label><button className="primary" disabled={busy || !vault || !healthy || !input || !output || input.address === output.address} onClick={manualSwap}>Quote & swap from vault</button></div><div className="panel"><div className="panelTitle"><h2>Execution protections</h2><span>Owner-initiated</span></div>{["Live router quote before signing","Minimum-output enforcement on-chain","Only vault-approved tokens","Registry size and slippage caps","Protocol fee shown through contract events","No unlimited wallet approval to the application"].map((x) => <div className="check" key={x}><i>✓</i>{x}</div>)}<div className="notice">Run “Sync markets & arm” once to approve the selected strategy and current reviewed market policies. Then use Disarm automation when you want manual-only trading.</div></div></section>;
  }

  function marketsView() { return <section className="panel full"><div className="panelTitle"><h2>Dynamic market availability</h2><span>{markets.length} discovered · {activeMarkets.length} executable</span></div><div className="marketHead"><span>Market</span><span>Status</span><span>Safe trade</span><span>Round-trip cost</span></div>{markets.map((m) => <div className="market large" key={m.pairAddress}><div><b>{m.symbol0}/{m.symbol1}</b><small>{m.official ? "Official seed" : "Factory discovered"} · ${m.liquidityUsd.toLocaleString()} liquidity</small></div><span className={`tag ${m.status.toLowerCase()}`}>{m.status}</span><span>${m.safeTradeUsd.toLocaleString()}</span><span>{m.roundTripCostBps.toFixed(0)} bps</span></div>)}</section>; }

  function strategiesView() { return <><section className="cards">{catalog.map((s) => <article className="strategy" key={s.id}><span>{s.active ? "ACTIVE" : "PENDING REVIEW"} · #{s.id}</span><h2>{s.name}</h2><p>{s.description}</p><div><b>${s.rules.maxTradeUsd} cap</b><small>{s.rules.maxTradesPerDay}/day · {s.rules.maxAssets} assets</small></div><button disabled={!s.active || tier < s.minimumTier} onClick={() => { setStrategyId(s.id); setTab("Control"); }}>{s.active ? `Select · ${TIER_NAMES[s.minimumTier]}` : "Awaiting review"}</button>{isReviewer && <button onClick={() => reviewStrategy(s, !s.active)}>{s.active ? "Pause listing" : "Approve Creator strategy"}</button>}</article>)}</section>{isReviewer && pending.length > 0 && <div className="notice">Reviewer mode is active. Creator strategies remain unusable until an explicit on-chain approval transaction.</div>}</>; }

  function creatorView() { return <section className="studio"><div><span className="eyebrow">CREATOR TIER</span><h1>Build rules—not unrestricted code.</h1><p>Creators publish constrained parameters that the vault, registry, and keeper can enforce. Strategies receive no wallet withdrawal rights and cannot bypass platform limits.</p><div className="metric"><span>Your tier</span><b>{TIER_NAMES[tier]}</b></div><div className="metric"><span>Requirement</span><b>Creator</b></div></div><div className="builder"><label>Name<input value={creatorForm.name} onChange={(e) => setCreatorForm({ ...creatorForm, name: e.target.value })}/></label><label>Description<textarea value={creatorForm.description} onChange={(e) => setCreatorForm({ ...creatorForm, description: e.target.value })}/></label><div className="two"><label>USDC reserve %<input type="number" min="10" max="90" value={creatorForm.reserveBps / 100} onChange={(e) => setCreatorForm({ ...creatorForm, reserveBps: Number(e.target.value) * 100 })}/></label><label>Rebalance threshold %<input type="number" min="1" max="30" value={creatorForm.rebalanceThresholdBps / 100} onChange={(e) => setCreatorForm({ ...creatorForm, rebalanceThresholdBps: Number(e.target.value) * 100 })}/></label><label>Max trade USD<input type="number" min="5" max="100000" value={creatorForm.maxTradeUsd} onChange={(e) => setCreatorForm({ ...creatorForm, maxTradeUsd: Number(e.target.value) })}/></label><label>Max assets<input type="number" min="1" max="12" value={creatorForm.maxAssets} onChange={(e) => setCreatorForm({ ...creatorForm, maxAssets: Number(e.target.value) })}/></label><label>Cooldown seconds<input type="number" min="60" max="86400" value={creatorForm.cooldownSeconds} onChange={(e) => setCreatorForm({ ...creatorForm, cooldownSeconds: Number(e.target.value) })}/></label><label>Trades/day<input type="number" min="1" max="48" value={creatorForm.maxTradesPerDay} onChange={(e) => setCreatorForm({ ...creatorForm, maxTradesPerDay: Number(e.target.value) })}/></label></div><label><input type="checkbox" checked={creatorForm.momentumOnly} onChange={(e) => setCreatorForm({ ...creatorForm, momentumOnly: e.target.checked })}/> Require positive momentum for entries</label>{tier < 3 ? <button className="primary" disabled={busy || !account} onClick={() => buyMembership(3)}>Upgrade to Creator with XCN</button> : <button className="primary" disabled={busy} onClick={publishStrategy}>Sign, publish & submit for review</button>}</div></section>; }

  function membershipView() { return <section className="grid"><div className="panel"><div className="panelTitle"><h2>XCN memberships</h2><span>Current: {TIER_NAMES[tier]} · {expiryLabel}</span></div>{[1,2,3].map((level) => <div className="revenue" key={level}><span>{TIER_NAMES[level]}</span><button disabled={busy || !account || tier > level} onClick={() => buyMembership(level)}>Buy/extend with XCN</button></div>)}</div><div className="panel"><div className="panelTitle"><h2>Inventor revenue</h2><span>Transparent contract routing</span></div>{[["Protocol trade fees","5–25 bps by tier"],["Creator strategy share","Review-set percentage of protocol fee"],["Memberships","Native XCN or WXCN"],["Keeper operations","Successful execution model"],["Future licensing/API","Partner agreements"]].map(([a,b]) => <div className="revenue" key={a}><span>{a}</span><b>{b}</b></div>)}</div></section>; }

  const views = { Control: controlView, Swap: swapView, Markets: marketsView, Strategies: strategiesView, "Creator Studio": creatorView, Membership: membershipView };
  const View = views[tab as keyof typeof views];
  return <div className="app"><header><div className="brand"><div className="mark">F</div><div><b>FLOWCONTROL</b><span>AI TRADER</span></div></div><button className="wallet" disabled={busy} onClick={connect}>{account ? short(account) : "Connect Wallet"}</button></header><nav>{Object.keys(views).map((name) => <button key={name} className={tab === name ? "active" : ""} onClick={() => setTab(name)}>{name}</button>)}</nav><main><div className="notice">{message}</div><View/></main><footer><b>FLOWCONTROL</b><span>Mainnet candidate · user-controlled vaults · no guaranteed returns</span></footer></div>;
}
