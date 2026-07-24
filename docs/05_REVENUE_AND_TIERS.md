# Revenue and memberships

## Trade fees

`FlowExecutionRouter` deducts the disclosed fee from input assets before each successful swap:

- Starter: 0.25%
- Flow: 0.18%
- Pro: 0.10%
- Creator: 0.08%
- Partner: 0.05%

The contract caps protocol fees at 0.50%. `FlowFeeRouter` distributes inventor treasury, reserve, creator, and referral shares on-chain.

## Native-XCN memberships

`FlowMembership` supports 30-day Flow, Pro, and Creator plans paid with native XCN or WXCN. Prices are configurable before or after deployment. Payments go directly to the inventor treasury; the membership contract can grant an expiring tier but cannot access a user's vault.

Default deployment values:

- Flow: 5,000 XCN / 30 days
- Pro: 15,000 XCN / 30 days
- Creator: 30,000 XCN / 30 days

These are launch placeholders, not price recommendations. Review XCN value, users, costs, and legal treatment before public release.

## Creator revenue

Creator strategies are submitted with an immutable rules hash and remain inactive until review. A reviewed strategy may receive a capped share of the protocol fee. Arbitrary creator code is never executed by the keeper or vault contracts.
