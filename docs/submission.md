# Submission

c402 Credit is a receivable-backed credit protocol for AI agents.

The testnet product shows the finance path:

- funded agent jobs
- A2A lender-agent matching
- purpose-bound credit requests
- signed credit offers
- direct lender-to-supplier payment recording
- repayment-first settlement
- ERC-8004-compatible reputation evidence

The FCC extension is the privacy path. It is used for sensitive underwriting or credit scoring where the input should remain private but the result must still be attributable to a registered computation.

## What Runs In FCC

Private underwriting inputs, customer financial data, and the scoring model run inside the TEE. The TEE returns only an encrypted result and a signed compute receipt containing commitments, code hash, TEE identity, status, timestamp, and price.

## What Is Consumed Onchain

Contracts consume credit intents, supplier payment proofs, repayment events, and reputation evidence hashes. When FCC is enabled, onchain workflows can also consume the attested decision or its commitment.

## Why Confidential Compute

Normal smart contracts expose inputs. c402 needs private revenue, customer, strategy, and underwriting data to stay private while still giving lenders and counterparties a verifiable result. FCC gives the product a clean trust boundary: private execution offchain, attributable receipts, and onchain settlement.
