# c402 Bounty Submission

## One-Liner

c402 is a confidential credit and compute protocol for AI agents: agents can pay for private/verifiable work over HTTP, borrow against funded jobs, and automatically repay lenders from future revenue.

## Bounty Fit

This submission targets Flare Confidential Compute applications where sensitive offchain logic must produce an output that onchain systems can consume.

c402 uses FCC for private AI-agent underwriting:

- Private inputs: agent revenue, job history, customer concentration, API expense history, repayment history, and owner/sponsor metadata.
- Private logic: the underwriting model that calculates credit limit, risk band, permitted spend categories, fee, and required repayment sweep.
- Public/onchain output: a compact credit decision and compute receipt.
- Onchain consumer: c402 credit contracts consume the decision to allow or reject a purpose-bound advance.

## What Runs Inside the TEE

The FCC extension receives encrypted underwriting data and executes the deterministic c402 credit model.

The TEE computes:

```json
{
  "agent": "0xAgent",
  "maximumCredit": "500",
  "riskBand": "B",
  "maximumDuration": 86400,
  "requiredRevenueSweep": 40,
  "validUntil": 1788036000
}
```

The raw financial data does not become public.

## What Is Verified or Consumed Onchain

The onchain workflow should verify:

- registered TEE identity
- registered code hash
- signed compute receipt
- output commitment
- valid decision window
- agent identity / ERC-8004 agent id
- maximum advance and repayment terms

The smart contract does not need the private input. It only needs the attested decision.

## Why Confidential Compute Is Needed

Normal smart contracts cannot privately inspect agent finances because all inputs and state are public.

Normal APIs can keep data private, but users must trust that:

- the advertised model ran
- inputs were not leaked
- the output was not manipulated
- the service followed the underwriting policy

FCC gives c402 a better primitive: private inputs, verifiable code identity, signed execution results, and onchain-consumable receipts.

## Credit Safety Architecture

The safer credit path avoids a large pooled lender vault.

Instead, lenders fund one payment intent at a time:

```text
funded job escrow
      +
TEE/underwriting approval
      +
lender pays supplier directly
      ↓
supplier receives funds
      ↓
job completion routes repayment to lender first
```

The `C402CreditIntent` contract implements this safer pattern:

- no pooled lender vault
- lender calls `paySupplier` with `msg.value`
- funds move directly to the allowlisted supplier
- the contract records the lender's repayment claim
- job completion credits lender repayment before agent proceeds
- payouts use pull withdrawals
- emergency pause blocks new credit

If the admin key is compromised, dormant lender wallet funds are not inside the contract to drain. The attacker can only affect future payments that a lender still chooses to sign/send.

## Current Testnet Status

Working today:

- Coston2 native-token c402 credit router
- Base Sepolia x402 settlement
- Base Sepolia ERC-8004 reputation write/readback
- c402 API discovery endpoints
- Dockerized API and dashboard
- local FCC-compatible compute flow

Blocked/optional:

- live FCC Coston2 runtime needs the official proxy/indexer DB credentials before the confidential compute route can be turned on in production.

The deployable public demo should run credit-only mode with `C402_ENABLE_COMPUTE=false`, while the submission explains the FCC integration boundary and includes the extension scaffold.

## Demo Script

1. Open the dashboard.
2. Show `/.well-known/c402.json` and `/openapi.json`.
3. Run the successful credit demo:
   - buyer funds a `$10` job
   - agent requests a `$1` data API advance
   - c402 approves against the receivable
   - supplier is paid directly
   - lender receives first repayment claim
   - agent receives remaining proceeds
   - ERC-8004-shaped reputation event is emitted
4. Show the failed-job path:
   - credit is stopped
   - advance is marked defaulted
   - negative credit passport event is emitted
5. Explain the FCC extension:
   - private underwriting data goes into the TEE
   - code hash and TEE identity are verified
   - onchain contracts consume only the attested decision

## Trust Assumptions

- FCC attestation and registry correctly identify the TEE and code hash.
- The underwriting code hash corresponds to the reviewed credit model.
- The API correctly passes the encrypted payload to FCC.
- Onchain contracts enforce limits from the attested output.
- Admin roles are multisig/timelocked before real funds.
- Lenders should use capped per-payment intents, not unlimited approvals.

## Repository Entry Points

- `apps/api`: public c402 HTTP API
- `apps/dashboard`: observability UI
- `packages/client`: agent-facing client
- `packages/server`: credit and payment state machines
- `contracts/src/C402CreditIntent.sol`: safer direct lender-to-supplier credit primitive
- `flare-extension`: FCC extension scaffold
- `docs/deployment.md`: deployment guide
- `docs/configuration.md`: secret and env boundaries
