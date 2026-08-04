# x402 Compatibility

c402 uses the x402 pattern, but it is not a replacement for x402.

x402 answers:

```text
How can a machine pay an API over HTTP?
```

c402 Credit answers:

```text
How can an agent borrow to pay an API, and repay the lender automatically?
```

c402 Compute answers:

```text
How can a client pay for private, verifiable computation?
```

## Standard x402 Flow

The x402 flow is:

1. Client requests a resource.
2. Server returns `402 Payment Required`.
3. Server includes a payment requirement.
4. Client retries with a signed payment payload.
5. Server verifies the payment through a facilitator.
6. Server serves the resource.
7. Server settles payment through the facilitator.
8. Server returns a payment response.

## c402 Compute Flow

The optional compute endpoint follows the x402 flow and adds confidential-compute headers.

First request:

```http
POST /credit-score
```

Challenge:

```http
HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: <base64url-json>
COMPUTE-REQUIRED: <base64url-json>
```

Retry:

```http
POST /credit-score
PAYMENT-SIGNATURE: <base64url-json>
COMPUTE-PAYLOAD: <base64url-json>
```

Success:

```http
HTTP/1.1 200 OK
PAYMENT-RESPONSE: <base64url-json>
COMPUTE-RECEIPT: <base64url-json>
```

The c402 extension adds:

- encrypted input,
- TEE identity,
- code hash,
- output commitment,
- signed compute receipt,
- payment release only after valid execution.

## c402 Credit Flow

The credit endpoints are currently plain JSON APIs:

- `POST /lenders/register`
- `POST /credit/jobs`
- `POST /credit/backing-sources`
- `POST /credit/request`
- `POST /credit/match`
- `POST /credit/offers/{offerId}/supplier-payment`
- `POST /credit/advances/{advanceId}/repay`
- `POST /credit/advances/{advanceId}/liquidate`

These endpoints model agent credit, lender matching, liens, and repayment. They do not currently require x402 payment for every API call.

## Current Status

Credit-only mode works without FCC.

Base Sepolia uses the public x402 facilitator by default:

```text
network: eip155:84532
asset: Base Sepolia USDC
facilitator: https://x402.org/facilitator
```

Flare Coston2 uses c402's own facilitator endpoint:

```text
network: eip155:114
asset: Coston2 testUSDT0
facilitator: /x402/flare-facilitator
transfer method: permit2
```

The Flare facilitator exposes the standard x402 operations:

- `GET /x402/flare-facilitator/supported`
- `POST /x402/flare-facilitator/verify`
- `POST /x402/flare-facilitator/settle`

The deployed `/credit-score` endpoint is disabled until Flare Confidential Compute is configured:

```text
C402_ENABLE_COMPUTE=false
```

When FCC is enabled, `/credit-score` becomes the x402-compatible confidential compute endpoint.

## Future Extension

To make every paid c402 API behave exactly like x402, wrap selected endpoints with the same 402 challenge pattern:

```text
Agent calls /credit/request
Server returns 402 + PAYMENT-REQUIRED
Agent pays with x402
Server underwrites the credit request
Server returns the credit offer
```

That keeps x402 as the payment primitive and c402 as the credit/confidential-compute extension.
