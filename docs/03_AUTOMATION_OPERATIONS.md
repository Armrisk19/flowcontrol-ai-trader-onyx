# Automation operations

Cloudflare Cron invokes the Worker every minute. Cron updates can take several minutes to propagate. A D1 lease prevents overlapping cycles.

Each cycle:

1. Verifies Chain ID 327.
2. Verifies bytecode for official Onyx dependencies and deployed FLOWCONTROL contracts.
3. Verifies router/factory and canonical pair relationships.
4. Enumerates a bounded batch of every factory pair.
5. Recalculates USDC prices, liquidity, safe trade tiers, and bidirectional round-trip cost.
6. Confirms unknown markets remain review-gated.
7. Reads owner-signed, timestamped, replay-resistant vault registrations that bind the strategy, referrer, and expiration.
8. Confirms each vault is unpaused, armed, and assigned to the keeper.
9. Builds a deterministic target across every eligible direct-USDC asset.
10. Applies strategy, market, and vault size caps.
11. Calculates the protocol fee first, requests a fresh route quote on the net input, and applies the stricter of the route token slippage caps and 1.00%.
12. Simulates the exact vault call.
13. Broadcasts only when both independent live gates are enabled.
14. Waits for confirmations and records the decision or error.

## Reliability

Use health monitoring on `/api/v1/health`, Worker alerts, D1 backups, and at least one independent Onyx RPC provider before public scale. A public RPC cannot promise unlimited capacity or uptime. The app fails closed when chain, bytecode, pair, registry, or quote verification fails.

## Registration and activity privacy

Keeper registration binds the owner, vault, strategy, referrer, expiry, and issuance time in the wallet signature. Older registrations cannot overwrite newer settings. Detailed vault decisions require a fresh owner signature and are not exposed through a public unauthenticated history endpoint.
