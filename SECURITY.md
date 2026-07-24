# Security model

## Authority separation

- **Vault owner:** may configure limits, choose strategies, arm/pause/revoke, trade manually, and withdraw.
- **Executor:** may only call `FlowVault.executeSwap` while armed and unexpired. It cannot withdraw or alter policies.
- **Protocol administrator:** manages global token/adapter/strategy status and emergency pauses. Use a multisignature wallet.
- **Keeper API:** stores signed vault registrations; it does not hold user withdrawal authority.

## Fail-closed gates

1. Chain ID must equal 327.
2. Official router, factory, canonical tokens, and current pair contracts must have code.
3. Adapter constructor verifies `router.factory()`.
4. Every path hop must resolve to a real factory pair.
5. Router independently quotes every trade and rejects a weak minimum output.
6. Vault enforces strategy allowlist, token allowlist, per-trade amount, daily spend, reserve, cooldown, daily count, executor identity, expiry, and armed status.
7. Cloudflare environment flag and D1 global switch must both allow live execution.
8. Keeper registration signatures bind strategy, referrer, expiry, and issue time; stale registrations are rejected.
9. Only recently assessed markets may enter an automated portfolio.
10. Transaction simulation must succeed before broadcast.
11. No LLM has signing authority.

## Required before public funds

- Independent Solidity audit and remediation
- Multisig administrator and treasury
- Monitoring/alerting and incident runbook
- Rate limiting and WAF for public API
- Canary limits and bug bounty
- Legal review for fees, subscriptions, creator marketplace, and jurisdictions
- Verify all addresses again immediately before deployment
