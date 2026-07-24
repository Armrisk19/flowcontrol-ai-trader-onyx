# FLOWCONTROL AI Trader — Onyx v0.2.1

A non-custodial automated spot-trading protocol for Onyx Mainnet.

## Included

- One isolated smart-contract vault per user
- Real Onyx wallet connection and Chain ID 327 enforcement
- Official Onyx V2 router/factory integration
- Complete factory pair enumeration
- Recurring liquidity, round-trip-cost, and route checks
- Automatic direct-USDC market universe expansion after review
- Dynamic Conservative, Balanced, and Momentum allocation
- Exact transaction simulation before broadcast
- Owner-initiated manual swaps through the same verified router and vault limits
- Signed, replay-resistant keeper registration and private activity retrieval
- Owner pause, executor revocation, expiry, reserves, cooldowns, daily caps, and token caps
- Transparent protocol, creator, referral, treasury, and reserve fee routing
- Native-XCN Flow, Pro, and Creator memberships
- Review-gated Creator Strategy registry foundation
- Cloudflare Worker/D1 keeper and Vercel web dashboard
- GitHub CI and guarded deployment workflows

## Honest scope

At package creation, the verified official Onyx execution pools are XCN/USDC and ETH/USDC. The scanner discovers every factory pair and automatically evaluates new pools, but unknown tokens require on-chain registry approval and manual security review before automation.

This version automates reviewed assets that have a fresh, reviewed direct-USDC market assessment. Users resynchronize their vault policies when newly reviewed markets become available. Its adapter architecture can add approved aggregators or cross-chain routes later; those routes are not silently enabled in this release.

## Safety status

The source is unaudited and has not been deployed. Real funds should remain disabled until `docs/04_PRODUCTION_GATES.md` is complete. Trading can lose money; no strategy or availability system guarantees profit, continuous liquidity, RPC uptime, or transaction inclusion.
