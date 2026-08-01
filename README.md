# c402

Purpose-bound credit for AI agents over HTTP.

c402 extends the x402 pattern from "pay this API request" to "finance this paid job or verified backing source, pay suppliers directly, and repay lenders before unrestricted agent proceeds are released."

Agents with idle earned balances can become lenders. Borrower agents request an amount against funded jobs and set a maximum acceptable fee. Lender agents publish their own ask rates. c402 matches only eligible lenders and picks the lowest-rate lender first.

The repository is structured for the current testnet product:

- `apps/api`: HTTP API for credit jobs, offers, supplier payment recording, repayment receipts, optional confidential compute.
- `apps/dashboard`: read-only dashboard for credit state, repayment receipts, and ERC-8004 reputation signals.
- `packages/protocol`: shared types, validation, signatures, commitments, and credit math.
- `packages/server`: x402 payment adapter, c402 compute service, and credit state machine.
- `packages/client`: c402 confidential-compute client for real x402 payment payloads.
- `packages/fcc-adapter`: Coston2 FCC proxy adapter.
- `packages/credit-model`: deterministic private credit assessment logic for the FCC extension.
- `contracts/src`: Solidity contracts for direct lender-to-supplier credit intents and ERC-8004 signal writing.
- `flare-extension/extension-tee`: Go FCC extension entrypoint.

## What Works Without FCC

The credit product does not require Flare Confidential Compute for the core testnet flow.

1. Buyer creates a funded receivable, or the agent registers a verified asset, subscription, or earnings backing source.
2. Agent requests purpose-bound credit against that repayment source.
3. Lender agents register available liquidity and credit policy.
4. c402 signs a credit offer if the supplier, amount, margin, and job state are valid.
5. c402 matches the offer to the cheapest eligible lender agent.
6. The borrower or sponsor posts collateral against the receivable.
7. The matched lender pays the supplier directly, using x402 or an onchain payment.
8. c402 records the supplier payment ID and creates a senior lien.
9. When the job completes, repayment is routed before agent proceeds.
10. If terms are broken, collateral and reserve can be liquidated for the lender.
11. ERC-8004-compatible reputation evidence is emitted from the repayment or default event.

FCC is optional and is used for private credit scoring/private underwriting through `/credit-score`. Enable it only when a real Coston2 FCC proxy is deployed and configured.

## Credit Products

c402 supports four credit products through the same request and lender-matching flow:

- `job-backed`: borrow against a funded job receivable. The job escrow repays first when the job completes.
- `asset-backed`: borrow against verified collateral value, such as tokenized collateral or future FXRP-style collateral support. The backing source records value, hard liquidation value, lock amount, verifier, and advance rate.
- `subscription-backed`: borrow against verified recurring revenue routed through c402. It must include hard liquidation value, such as escrowed subscription receipts, a sponsor bond, or a sweep-router reserve.
- `earnings-backed`: borrow against verified historical x402 earnings routed through c402. It must include hard liquidation value, such as an earnings reserve, owner bond, or sweep-router balance.

For non-job products, register a source first with `POST /credit/backing-sources`, then use its `sourceId` as `repaymentSource` in `POST /credit/request`.

The approval invariant is:

```text
principal + borrower maximum fee <= liquidatable recovery value
```

Projected revenue can size a credit line, but it cannot replace collateral. If a subscription-backed or earnings-backed source has `liquidationValueAtomic: "0"`, borrowing against it is declined.

## Environment

Copy `.env.production.example` and set real values:

```bash
C402_PUBLIC_URL=https://your-api.example
C402_CREDIT_ENDPOINT=https://your-api.example/credit
C402_CREDIT_CONTRACT=0x...
C402_CREDIT_NETWORK=eip155:114

C402_NETWORK=eip155:84532
C402_ASSET=0x036CbD53842c5426634e7929541eC2318f3dCF7e
C402_PAY_TO=0x...
X402_FACILITATOR_URL=https://x402.org/facilitator

C402_ENABLE_COMPUTE=false
```

For FCC:

```bash
C402_ENABLE_COMPUTE=true
C402_FCC_MODE=coston2
C402_FCC_PROXY_URL=https://your-fcc-proxy.example
C402_FCC_EXTENSION_ID=0x...
C402_FCC_TEE_ID=0x...
C402_EXPECTED_CODE_HASH=0x...
```

Do not commit `.env`, private keys, proxy keys, or deployment keys.

## Run

```bash
npm install
npm run build
npm run dev:api
npm run dev:dashboard
```

API: `http://127.0.0.1:4021`

Dashboard: `http://127.0.0.1:4022`

## Credit API

Create a funded job:

```bash
curl -X POST http://127.0.0.1:4021/credit/jobs \
  -H 'content-type: application/json' \
  -d '{"buyer":"0xBuyer","agent":"0xAgent","escrowAmountAtomic":"10000000","description":"Research job"}'
```

Request credit:

```bash
curl -X POST http://127.0.0.1:4021/credit/request \
  -H 'content-type: application/json' \
  -d '{"agent":"0xAgent","amountAtomic":"1000000","purpose":"data","supplier":"Market Data API","supplierDomain":"data.example.com","repaymentSource":"job-id","maximumFeeAtomic":"100000"}'
```

Register a non-job backing source:

```bash
curl -X POST http://127.0.0.1:4021/credit/backing-sources \
  -H 'content-type: application/json' \
  -d '{"sourceId":"asset-source-1","productType":"asset-backed","agent":"0xAgent","valueAtomic":"5000000","liquidationValueAtomic":"5000000","advanceRateBps":6500,"evidenceId":"ftso-proof-1"}'
```

Request against that source:

```bash
curl -X POST http://127.0.0.1:4021/credit/request \
  -H 'content-type: application/json' \
  -d '{"agent":"0xAgent","productType":"asset-backed","amountAtomic":"1000000","purpose":"data","supplier":"Market Data API","supplierDomain":"data.example.com","repaymentSource":"asset-source-1","maximumFeeAtomic":"100000"}'
```

Register a lender agent:

```bash
curl -X POST http://127.0.0.1:4021/lenders/register \
  -H 'content-type: application/json' \
  -d '{"agent":"0xLenderAgent","availableLiquidityAtomic":"25000000","asset":"USDC","networks":["eip155:84532"],"minFeeBps":300,"maxDurationSeconds":86400,"allowedPurposes":["data","compute"],"allowedSupplierDomains":["data.example.com"],"acceptedRiskBands":["A","B"],"reputationScore":75}'
```

`maximumFeeAtomic` is the borrower cap, not the final interest rate. `minFeeBps` is the lender's ask. The selected lender's ask determines the final repayment fee.

Match a credit offer:

```bash
curl -X POST http://127.0.0.1:4021/credit/match \
  -H 'content-type: application/json' \
  -d '{"offerId":"offer-id"}'
```

Post collateral against the receivable:

```bash
curl -X POST http://127.0.0.1:4021/credit/jobs/job-id/collateral \
  -H 'content-type: application/json' \
  -d '{"pledgor":"0xBorrowerAgent","amountAtomic":"200000"}'
```

Record lender-to-supplier payment:

```bash
curl -X POST http://127.0.0.1:4021/credit/offers/offer-id/supplier-payment \
  -H 'content-type: application/json' \
  -d '{"lender":"0xLender","supplierPaymentId":"x402-or-chain-payment-id"}'
```

Liquidate if the advance misses its deadline or defaults:

```bash
curl -X POST http://127.0.0.1:4021/credit/advances/adv-request-id/liquidate \
  -H 'content-type: application/json' \
  -d '{"reason":"deadline_missed"}'
```

Complete and repay:

```bash
curl -X POST http://127.0.0.1:4021/credit/jobs/job-id/complete \
  -H 'content-type: application/json' \
  -d '{"advanceId":"adv-request-id"}'
```

Repay any generic advance:

```bash
curl -X POST http://127.0.0.1:4021/credit/advances/adv-request-id/repay \
  -H 'content-type: application/json' \
  -d '{"repaymentSource":"asset-source-1","grossRevenueAtomic":"1200000"}'
```

## Verification

```bash
npm run build
forge build
```

There are no committed example agents, fake adapters, or test suites in the cleaned tree.
