# Known limitations of v0.2.1

- The package is source code, not a deployed service.
- It is unaudited and live execution defaults to disabled.
- Current verified Onyx spot breadth is limited by real Onyx liquidity. At build time, the official execution pools used for launch are XCN/USDC and ETH/USDC.
- Automated dynamic expansion currently requires a direct USDC pool. Cross-chain and aggregator adapters are intentionally not activated in this version.
- Creator submissions are real constrained on-chain rule sets and remain review-gated; arbitrary strategy code is intentionally excluded.
- The public Onyx RPC is suitable for integration and testing, but public production scale should use redundant RPC service.
- Cloudflare's free 10 ms Worker CPU allowance is unlikely to be dependable for the one-minute full-market scan; budget at least the paid-plan minimum plus RPC and audit costs.
- No strategy guarantees profit, market availability, transaction inclusion, or protection from all smart-contract and market risks.

- The PWA caches the interface shell only; fresh market, strategy, and execution state still require network access.
- The included single-keeper loop is an early production architecture; large public scale requires Queue or Workflow sharding, additional executors, nonce coordination, and load testing.

- This release is spot-only. It does not provide leverage, futures, perpetuals, borrowing, or short selling.
- Contract limits cap spend, frequency, reserves, route slippage, and token access; they do not create a guaranteed mark-to-market stop-loss or prevent losses from normal price movement.
- Public-mempool swaps can still face MEV or sandwich activity within the user's enforced minimum-output tolerance. Private transaction routing is not included because no verified Onyx private relay is configured in this release.
- New liquid markets require explicit token review, registry approval, operational review, observation time, and user vault-policy synchronization. Market breadth therefore expands safely rather than instantly.
- “Always available” means continuous monitoring and fail-closed recovery attempts; no application can guarantee RPC uptime, pool liquidity, chain liveness, or transaction inclusion.
