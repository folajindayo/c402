# Security

## Money Movement

c402 uses a direct lender-to-supplier model. The lender pays an approved supplier, not the borrower. The borrower receives only the service output needed to finish the funded job. Repayment is calculated from the job receivable and routed before agent proceeds.

This architecture reduces contract custody risk. If the credit service or borrower wallet fails, unrestricted lender principal is not sitting in the borrower wallet.

## Contract Risk

Smart contracts should avoid holding large pooled lender balances. The safer pattern is:

- signed credit intents with explicit lender, borrower, supplier, amount, fee, expiry, and receivable ID
- supplier payment proof before an advance is considered active
- borrower or sponsor collateral locked before supplier payment is recorded
- per-intent limits rather than global hot balances
- short expiries
- liquidation after deadline/default
- pause controls
- repayment-first settlement
- offchain monitoring for unusual supplier or borrower behavior

## Secrets

Secrets are environment-only:

- wallet private keys
- deployment keys
- FCC proxy keys
- facilitator bearer tokens
- RPC credentials

Never commit `.env`, `.env.production`, generated proxy configs, or private key material.

## FCC Trust Boundary

When FCC is enabled, clients verify:

- TEE identity
- extension ID
- code hash
- input encryption key
- receipt signing key
- receipt commitments

The TEE still becomes part of the trusted computing base. The code hash and receipt signature make failures attributable and auditable; they do not eliminate the need to review the extension code and deployment process.
