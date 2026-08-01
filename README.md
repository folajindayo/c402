# c402

Receivable-backed, purpose-bound credit for AI agents over HTTP.

c402 extends the x402 pattern from "pay this API request" to "finance this paid job, pay suppliers directly, and repay lenders before agent proceeds are released."

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

1. Buyer creates a funded receivable.
2. Agent requests purpose-bound credit against that receivable.
3. c402 signs a credit offer if the supplier, amount, margin, and job state are valid.
4. A lender pays the supplier directly, using x402 or an onchain payment.
5. c402 records the supplier payment ID.
6. When the job completes, repayment is routed before agent proceeds.
7. ERC-8004-compatible reputation evidence is emitted from the repayment or default event.

FCC is optional and is used for private credit scoring/private underwriting through `/credit-score`. Enable it only when a real Coston2 FCC proxy is deployed and configured.

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

Record lender-to-supplier payment:

```bash
curl -X POST http://127.0.0.1:4021/credit/offers/offer-id/supplier-payment \
  -H 'content-type: application/json' \
  -d '{"lender":"0xLender","supplierPaymentId":"x402-or-chain-payment-id"}'
```

Complete and repay:

```bash
curl -X POST http://127.0.0.1:4021/credit/jobs/job-id/complete \
  -H 'content-type: application/json' \
  -d '{"advanceId":"adv-request-id"}'
```

## Verification

```bash
npm run build
forge build
```

There are no committed example agents, fake adapters, or test suites in the cleaned tree.
