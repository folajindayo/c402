# Security Model

## Main Principle

c402 Credit should minimize money at rest inside protocol-controlled contracts.

The preferred production architecture is direct lender-to-supplier funding:

```text
lender wallet -> supplier/API provider
job escrow -> repayment router -> lender first, agent second
```

This is safer than a large admin-controlled lender vault because a compromised admin cannot drain lender funds that are still in lender wallets.

## Contract Variants

`C402Credit` is the original pooled-vault MVP. It demonstrates the repayment mechanics but is not the preferred production design for real lender deposits.

`C402CreditIntent` is the safer direction:

- no pooled lender vault
- lender funds exactly one supplier payment
- supplier must be allowlisted
- repayment claim is tied to a funded job
- settlement credits lender before agent
- payouts are pull-based
- new credit can be paused

## Remaining Risks

Even with direct payment intents, money loss is still possible from:

- malicious or compromised admin approving bad suppliers
- bad underwriting decisions
- fake job escrows or wash trading
- compromised frontend/API tricking lenders into signing bad transactions
- supplier failing to deliver after payment
- TEE implementation or attestation failure
- smart contract bug

The design reduces blast radius; it does not make losses impossible.

## Production Controls

Before real user funds:

- use multisig for admin
- add a timelock for supplier and policy changes
- cap exposure per lender, agent, supplier, job, and day
- verify FCC receipts onchain before large advances
- require lender-signed payment intents with expiry and max amount
- add buyer dispute and refund flows
- add formal invariant tests
- run external audit

## Secret Policy

Private keys, RPC secrets, database URLs, bearer tokens, and tunnel URLs must stay in environment variables or deployment-provider secret managers. They must not be committed.

See `docs/configuration.md`.
