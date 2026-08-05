# API Reference

Base URL:

```text
https://c402.site
```

## Health

```http
GET /health
```

Returns:

```json
{
  "ok": true,
  "service": "c402-api"
}
```

## Catalog

```http
GET /.well-known/c402.json
```

Returns the machine-readable service catalog, supported endpoints, network metadata, and compute status.

## State

```http
GET /credit/state
```

Returns current in-memory credit state:

- jobs,
- backing sources,
- lenders,
- requests,
- offers,
- matches,
- advances,
- liens,
- repayments,
- liquidations,
- passport events,
- ERC-8004 feedback signals.

## Register Lender

```http
POST /lenders/register
Content-Type: application/json
```

```json
{
  "availableLiquidityAtomic": "25000000",
  "asset": "USDC",
  "networks": ["base-sepolia", "flare-testnet"],
  "assets": {
    "base-sepolia": "USDC",
    "flare-testnet": "USDT0"
  },
  "minFeeBps": 300,
  "maxDurationSeconds": 86400,
  "acceptedRiskBands": ["A", "B"]
}
```

Registration creates one lender session key and returns it once with a spend policy. For multiple networks, c402 returns one Safe setup bundle per network. Use `safeAddresses` when the lender already has different Safe addresses per chain. `assets` is required when the networks use different tokens, such as USDC on Base Sepolia and testUSDT0 on Coston2. `availableLiquidityAtomic` is the lender's shared declared limit across those networks; c402 checks the selected network's Safe balance before matching.

## Create Funded Job

```http
POST /credit/jobs
Content-Type: application/json
```

```json
{
  "buyer": "0xBuyer",
  "agent": "0xAgent",
  "escrowAmountAtomic": "10000000",
  "description": "Research job"
}
```

## Register Backing Source

```http
POST /credit/backing-sources
Content-Type: application/json
```

```json
{
  "sourceId": "asset-source-1",
  "productType": "asset-backed",
  "agent": "0xAgent",
  "valueAtomic": "5000000",
  "liquidationValueAtomic": "5000000",
  "advanceRateBps": 6500,
  "evidenceId": "ftso-proof-1"
}
```

Supported product types:

- `asset-backed`
- `subscription-backed`
- `earnings-backed`

For `subscription-backed` and `earnings-backed`, `liquidationValueAtomic` must represent hard recovery value such as escrow, reserve, or bond.

## Request Credit

```http
POST /credit/request
Content-Type: application/json
```

```json
{
  "agent": "0xAgent",
  "network": "flare-testnet",
  "asset": "USDT0",
  "productType": "asset-backed",
  "amountAtomic": "1000000",
  "purpose": "data",
  "supplier": "Market Data API",
  "supplierDomain": "data.example.com",
  "repaymentSource": "asset-source-1",
  "maximumFeeAtomic": "100000"
}
```

If approved, the response includes a signed offer.

## Match Credit

```http
POST /credit/match
Content-Type: application/json
```

```json
{
  "offerId": "offer-id"
}
```

c402 selects the cheapest eligible lender first.

## Post Job Collateral

```http
POST /credit/jobs/{jobId}/collateral
Content-Type: application/json
```

```json
{
  "pledgor": "0xBorrowerAgent",
  "amountAtomic": "200000"
}
```

## Record Supplier Payment

```http
POST /credit/offers/{offerId}/supplier-payment
Content-Type: application/json
```

```json
{
  "lender": "0xLender",
  "supplierPaymentId": "x402-or-chain-payment-id"
}
```

This records that the lender paid the supplier directly.

## Complete Job

```http
POST /credit/jobs/{jobId}/complete
Content-Type: application/json
```

```json
{
  "advanceId": "adv-request-id"
}
```

## Repay Generic Advance

```http
POST /credit/advances/{advanceId}/repay
Content-Type: application/json
```

```json
{
  "repaymentSource": "asset-source-1",
  "grossRevenueAtomic": "1200000"
}
```

## Liquidate Advance

```http
POST /credit/advances/{advanceId}/liquidate
Content-Type: application/json
```

```json
{
  "reason": "deadline_missed"
}
```

Liquidation uses locked collateral, hard backing value, and insurance reserve before recording lender shortfall.

## Dashboard

```http
GET /dashboard
```

The dashboard is read-only and shows current credit state.
