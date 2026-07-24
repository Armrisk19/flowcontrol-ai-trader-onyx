# Deployment order — browser-first and fail-closed

## 1. Private GitHub and CI

Upload the complete repository to private GitHub and run **FLOWCONTROL CI**. Resolve every compile, unit-test, Worker-build, web-build, and Onyx fork-test failure.

## 2. Separate roles

Create separate addresses:

- Temporary deployer: only enough XCN for deployment gas
- Final administrator: multisignature or hardware-wallet controlled
- Inventor treasury: receives protocol and membership revenue
- Security reserve: separate address
- Keeper executor: new low-balance operational wallet used only for gas

The deployment script requires the final administrator, treasury, reserve, and temporary deployer to be separated appropriately. It grants operational roles to the final administrator and then removes every temporary deployer role.

## 3. GitHub Onyx environment

Create GitHub Environment `onyx-mainnet`.

Encrypted secrets:

- `DEPLOYER_PRIVATE_KEY`
- `FINAL_ADMIN_ADDRESS`
- `TREASURY_ADDRESS`
- `RESERVE_ADDRESS`

Optional environment variables:

- `FLOW_PLAN_XCN` (default 5000)
- `PRO_PLAN_XCN` (default 15000)
- `CREATOR_PLAN_XCN` (default 30000)

Run **Deploy Onyx Contracts** and type `DEPLOY-ONYX-327`. Download `deployments.onyx.json`.

## 4. Independent contract verification

Verify deployed bytecode and constructor arguments on the Onyx explorer. Re-run dependency checks against the current official Onyx registry. Complete an independent audit before live public use.

## 5. Cloudflare D1 and Worker

A one-minute production scanner is likely to require Cloudflare Workers Paid because the free plan permits only 10 ms CPU per invocation. Create D1 database `flowcontrol-ai-trader`.

Create GitHub Environment `keeper-shadow`.

Variables:

- `FLOW_VAULT_FACTORY`
- `FLOW_EXECUTION_ROUTER`
- `FLOW_ADAPTER`
- `FLOW_TOKEN_REGISTRY`
- `FLOW_STRATEGY_REGISTRY`
- `FLOW_TIER_MANAGER`
- `ALLOWED_WEB_ORIGIN`
- `D1_DATABASE_ID`

Secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `EXECUTOR_PRIVATE_KEY`
- `ADMIN_API_KEY`

Run **Deploy Keeper Worker (Shadow)** and type `DEPLOY-SHADOW`. The workflow renders addresses, applies D1 migrations, bootstraps the Worker, installs encrypted secrets, and finishes with `LIVE_EXECUTION=false`.

## 6. Vercel web deployment

Import the repository into Vercel. Add every `VITE_*` address from `deployments.onyx.json`, the Worker URL, and the keeper executor public address. Deploy and confirm the dashboard says `SYSTEM VERIFIED`.

## 7. Shadow canary

Keep both live gates disabled. Create an internal vault with tiny balances, configure automation, and review at least seven full days of shadow decisions, market state changes, RPC errors, and simulated reverts.

## 8. Low-value live canary

After audit remediation, run **Deploy Keeper Worker (Live Gate Only)** and type `DEPLOY-LIVE-GATED-327`. That enables the code gate while verifying D1 remains paused. Then use **Set Keeper Execution State** only for the approved canary. Start with one internal vault and an amount you can afford to lose.

## 9. Public release

Release publicly only after successful emergency drills, observed live execution, fee accounting reconciliation, legal review, disclosures, support procedures, and incident-response ownership.
