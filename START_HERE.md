# FLOWCONTROL AI Trader — start here

This repository is a **mainnet-capable production candidate**, not a deployed or audited service. It contains real wallet transactions, owner-initiated swaps, real Onyx V2 swap routing, constrained personal vaults, recurring automation, dynamic market discovery, XCN memberships, Creator strategies, fee routing, signed keeper registration, and emergency controls.

## What you need before real funds

1. A private GitHub repository.
2. A temporary deployment wallet funded with only enough XCN for contract gas.
3. Separate final-admin, inventor-treasury, reserve, and keeper addresses.
4. Cloudflare Workers Paid for the one-minute production keeper; the free 10 ms CPU allowance is not a reliable fit for recurring market scans.
5. Vercel for the web application.
6. Independent Solidity review/audit and a shadow canary.

Never paste a seed phrase or private key into ChatGPT, source files, GitHub commits, Vercel variables, or ordinary messages. Store private keys only as encrypted deployment/Worker secrets.

## First action

Upload this entire folder to a new **private** GitHub repository.

Commit message:

```text
Add FLOWCONTROL Onyx mainnet candidate
```

Then open **Actions → FLOWCONTROL CI → Run workflow**. Continue only when compile, unit tests, web build, Worker build, and Onyx fork checks all pass.

## Deployment order

Read `docs/01_DEPLOYMENT_ORDER.md`. Live execution has two independent gates and ships disabled:

- Worker variable `LIVE_EXECUTION=false`
- D1 value `execution_paused=true`

Both must be explicitly enabled after audit and canary review.
