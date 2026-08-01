# Architecture

c402 has two independent layers:

1. Agent credit: receivable-backed lending for agents, usable today without FCC.
2. Confidential compute: optional c402/x402 extension for private, attested execution on Flare FCC.

## Credit Flow

The production credit invariant is simple: lender funds do not enter the borrower wallet.

Buyer funds a job receivable. The agent requests credit for a specific supplier and purpose. Lender agents register liquidity and policy. The service signs an offer only if the job is funded, the supplier is allowed, the advance is within policy, and the job still has enough margin. c402 matches the offer to the best eligible lender agent. The borrower or sponsor posts collateral, then the lender pays the supplier directly and records the supplier payment identifier. c402 creates a senior lien against the receivable. On job completion, repayment is calculated before agent proceeds. On missed deadline or default, locked collateral and reserve can be liquidated for the lender, with any shortfall recorded against the borrower reputation.

This limits loss if an agent fails or if an agent wallet is compromised, because the borrower never receives unrestricted loan principal.

## Main Components

- API service: exposes credit and optional compute endpoints.
- Credit state machine: jobs, requests, offers, advances, repayments, passport events.
- A2A lender matcher: ranks lender agents by eligibility, fee fit, liquidity headroom, risk policy, and reputation.
- Lien and collateral engine: locks borrower/sponsor bond, creates senior repayment claims, releases collateral on repayment, and liquidates on default.
- x402 adapter: verifies and settles payment payloads through an x402 facilitator.
- ERC-8004 writer contract: records credit feedback hashes for agent reputation.
- Credit intent contract: binds borrower, lender, supplier, receivable, fee, expiry, and supplier payment proof.
- FCC adapter: talks to a Coston2 FCC proxy when confidential compute is enabled.

## FCC Boundary

FCC is used when sensitive input should not be public: underwriting inputs, customer financial data, model prompts, or proprietary scoring logic. The TEE receives encrypted input, runs the registered code version, returns encrypted output, and signs a compute receipt. Onchain consumers only need the signed output or a commitment to it.

The credit product remains valid when FCC is off; private underwriting becomes available when FCC is on.
