# Market availability and expansion

## Complete discovery

The keeper calls the Onyx V2 factory's `allPairsLength()` and `allPairs(index)` functions in bounded batches. This discovers old pools and newly created pools without relying on a recent-log window.

## Activation pipeline

Every pool receives one of four states:

- `ACTIVE`: reviewed, both tokens approved on-chain, observation period passed, round-trip cost no more than 1.00%, and safe quote depth at least $500
- `LIMITED`: reviewed, both tokens approved, observation passed, round-trip cost no more than 1.50%, and safe quote depth at least $100
- `WATCHLIST`: discovered but awaiting token review, registry approval, or observation history
- `PAUSED`: inadequate liquidity, failed quotes, unsafe execution cost, or dependency failure

Official XCN/USDC and ETH/USDC pools are seeded, but still rechecked every cycle.

## Dynamic strategy universe

Automation uses every recently assessed `ACTIVE` or `LIMITED` asset with a reviewed direct-USDC pool and an enabled user-vault policy. The user's setup transaction configures all currently eligible assets in one batch. The keeper ranks them by status, liquidity, safe size, and one-hour momentum.

Cross-pairs remain visible and monitored. They are not used for automated portfolio pricing until both legs have reliable USDC valuation and an approved execution path.

## Adding a new token

A new token must pass contract-code, decimals, transfer behavior, proxy/admin, minting, blacklist, tax, price-source, buy-route, and sell-route review. The final administrator then adds it to `FlowTokenRegistry`. The Worker admin endpoint may mark its pool reviewed only after the registry reports both tokens tradable.

This process deliberately chooses reliable breadth over enabling every pool instantly.


## Adding a newly liquid token

1. Let complete factory enumeration discover its direct-USDC pair.
2. Observe it for the configured waiting period.
3. Run `TOKEN_ADDRESS=... FLOW_TOKEN_REGISTRY=... npm run build:token-config -w @flowcontrol/contracts` to generate verified registry calldata.
4. Review token source, transfer behavior, admin powers, oracle/price behavior, liquidity concentration, and exit liquidity.
5. Submit the registry transaction from the final administrator.
6. Run **Review Discovered Market** to approve the pair in the operational registry.
7. The next scan activates it only when all live quote and cost thresholds pass.

## Vault policy synchronization

New markets never gain access to an existing vault silently. After a newly reviewed market activates, the owner explicitly runs **Sync markets & arm** to add its token policy, trade cap, daily cap, and reserve setting. This preserves dynamic breadth while keeping wallet permissions user-approved.
