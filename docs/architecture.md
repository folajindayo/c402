# Architecture

c402 has two independent layers:

1. Agent credit: receivable-backed lending for agents, usable today without FCC.
2. Confidential compute: optional c402/x402 extension for private, attested execution on Flare FCC.

## Credit Flow

The production credit invariant is simple: lender funds do not enter the borrower wallet.

The agent borrows against one repayment source:

- `job-backed`: funded job escrow.
- `asset-backed`: verified collateral value.
- `subscription-backed`: verified recurring subscription revenue plus escrowed receipts, a sponsor bond, or a sweep-router reserve.
- `earnings-backed`: verified historical agent earnings plus an earnings reserve, owner bond, or sweep-router balance.

The agent requests a credit amount for a specific supplier and purpose, plus a maximum acceptable fee. Lender agents register liquidity, policy, and their ask rate. The service signs a borrow intent only if the repayment source is valid, the supplier is allowed, the advance is within policy, and the source still has enough hard liquidation value at the borrower fee cap. c402 matches the offer to the lowest-rate eligible lender agent, using reputation and liquidity as tie-breakers. For job-backed credit, funded job escrow and posted collateral are recovery sources. For non-job credit, the backing source records both projected value and hard liquidation value. The lender pays the supplier directly and records the supplier payment identifier. c402 creates a senior lien against the repayment source. On repayment, principal and fee are routed before unrestricted agent proceeds. On missed deadline or default, locked collateral, liquidatable backing value, and reserve can be liquidated for the lender, with any shortfall recorded against the borrower reputation.

The core safety invariant is that projected revenue cannot replace collateral:

```text
principal + maximum borrower fee <= hard liquidatable recovery value
```

This limits loss if an agent fails or if an agent wallet is compromised, because the borrower never receives unrestricted loan principal.

## Main Components

- API service: exposes credit and optional compute endpoints.
- Credit state machine: jobs, requests, offers, advances, repayments, passport events.
- Backing source registry: asset, subscription, and earnings sources with verifier evidence, advance rate, and locked capacity.
- A2A lender matcher: ranks lender agents by eligibility, fee fit, liquidity headroom, risk policy, and reputation.
- Lien and collateral engine: locks borrower/sponsor bond, creates senior repayment claims, releases collateral on repayment, and liquidates on default.
- x402 adapter: verifies and settles payment payloads through an x402 facilitator.
- ERC-8004 writer contract: records credit feedback hashes for agent reputation.
- Credit intent contract: binds borrower, lender, supplier, receivable, fee, expiry, and supplier payment proof.
- FCC adapter: talks to a Coston2 FCC proxy when confidential compute is enabled.

## FCC Boundary

FCC is used when sensitive input should not be public: underwriting inputs, customer financial data, model prompts, or proprietary scoring logic. The TEE receives encrypted input, runs the registered code version, returns encrypted output, and signs a compute receipt. Onchain consumers only need the signed output or a commitment to it.

The credit product remains valid when FCC is off; private underwriting becomes available when FCC is on.
