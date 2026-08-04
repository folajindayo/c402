# Loan Products

c402 gives AI agents purpose-bound credit. The borrower does not receive unrestricted loan funds. A matched lender pays the approved supplier directly, and c402 records a senior repayment claim against a verified source.

## Shared Rules

Every approved loan has:

- a borrower agent,
- a lender agent,
- a supplier,
- a purpose,
- a repayment source,
- a senior lien,
- hard liquidatable recovery value.

The safety invariant is:

```text
principal + maximum borrower fee <= hard liquidatable recovery value
```

Projected future revenue can size a credit line, but it cannot replace collateral.

## Job-Backed

The agent borrows against one funded job.

Example:

```text
Customer funds $100 job
Agent borrows $15 for APIs
Lender pays API supplier directly
Job completes
Lender is repaid before agent proceeds
```

Recovery sources:

- funded job escrow,
- optional borrower or sponsor collateral,
- insurance reserve.

This is the strongest first product because the receivable already exists.

## Asset-Backed

The agent borrows against verified collateral value.

Examples:

- USDC,
- USDT0,
- FLR,
- FXRP,
- ETH,
- tokenized vault shares,
- API credit balances with discounted liquidation value.

The backing source records both projected value and `liquidationValueAtomic`. c402 only lends against the recoverable value.

## Subscription-Backed

The agent borrows against recurring subscription revenue routed through c402.

Because subscriptions can churn, subscription revenue alone is not enough. The source must include hard recovery value, such as:

- escrowed subscription receipts,
- sponsor bond,
- sweep-router reserve,
- locked settlement balance.

If `liquidationValueAtomic` is `0`, underwriting declines the request.

## Earnings-Backed

The agent borrows against verified historical or incoming earnings.

This works for agents that earn from many small x402 payments rather than one job or subscription.

Acceptable recovery sources include:

- earnings reserve,
- owner bond,
- marketplace payout escrow,
- sweep-router balance.

Past earnings improve confidence, but they do not guarantee repayment. The hard recovery value remains mandatory.

## Lender Matching

Borrowers specify the amount and maximum acceptable fee. Lenders publish their own minimum fee rates and risk policies.

c402 selects the cheapest eligible lender first, then uses reputation and liquidity as tie-breakers.

```text
Borrower asks for $1.00 and allows up to $0.10 fee
Lender A asks 9%
Lender B asks 2.5%
c402 selects Lender B if all policies match
```

The borrower does not set the interest rate. The borrower only sets the maximum they are willing to pay.
