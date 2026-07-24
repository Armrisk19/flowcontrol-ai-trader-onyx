# Production gates

A release is not production-ready until every item is true:

- [ ] Dependency installation completed from a clean checkout
- [ ] Solidity compile and all unit tests passed
- [ ] Web and Worker TypeScript builds passed
- [ ] Onyx fork tests passed
- [ ] Signed registration replay and referrer-tampering tests passed
- [ ] Manual swap fee, quote, and registry-slippage tests passed
- [ ] Owner-signed activity-history authorization tested
- [ ] Official Onyx addresses reverified on deployment day
- [ ] Deployed bytecode and constructor arguments verified
- [ ] Independent Solidity audit completed and findings remediated
- [ ] Multisig/hardware-wallet admin, treasury, and reserve configured
- [ ] Temporary deployer roles removed
- [ ] Keeper key isolated and funded only for gas
- [ ] Cloudflare paid capacity and CPU alerts configured
- [ ] Worker secrets encrypted and absent from source
- [ ] API authentication, rate limiting, and WAF configured
- [ ] Seven-day shadow canary reviewed
- [ ] Low-value live canary completed
- [ ] Fee accounting reconciled on-chain
- [ ] Emergency pause tested end to end
- [ ] Executor revocation tested end to end
- [ ] Market-review and token-removal drills tested
- [ ] Monitoring, incident alerts, and response ownership tested
- [ ] User risk, fee, slippage, and non-guarantee disclosures published
- [ ] Legal and tax review completed
