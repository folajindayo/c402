# Architecture

c402 is organized as a standard TypeScript monorepo plus Solidity contracts and an optional Flare Confidential Compute extension.

## Repository Layout

```text
apps/
  api/              HTTP API, discovery metadata, credit routes, optional compute route
  agent-demo/       CLI/demo agent that exercises credit or confidential compute flows
  dashboard/        Read-only operational dashboard
packages/
  protocol/         Wire types, headers, commitments, canonical JSON, crypto helpers
  client/           Agent-facing c402Fetch client
  server/           Payment handling, c402 middleware, credit state machine
  credit-model/     Deterministic underwriting/scoring model used by the MVP
  fcc-adapter/      Local deterministic adapter and Coston2 FCC adapter boundary
contracts/
  src/              C402Credit and ERC-8004 writer contracts
  test/             Foundry tests
deploy/
  docker/           Production Dockerfiles
  compose/          Production Docker Compose files
deployments/        Public testnet addresses and transaction receipts
docs/               Deployment, configuration, and Flare notes
flare-extension/    Optional FCC extension scaffold and handler
tests/              Node test suite
```

## Runtime Boundaries

`apps/api` is the public service boundary. It exposes:

- `GET /.well-known/c402.json` for machine discovery.
- `GET /v1/services/catalog` for service metadata.
- `GET /openapi.json` for integration tooling.
- `/credit/*` for receivable-backed agent credit.
- `/credit-score` only when confidential compute is enabled.

`packages/server` owns the protocol state transitions. The invariant is intentionally inspectable: advances must be backed by a funded receivable, restricted by purpose/domain, paid directly to the supplier, and repaid before agent proceeds.

`packages/protocol` owns serialization and commitments. Anything that crosses HTTP headers, receipts, signatures, or evidence hashes belongs there instead of being duplicated in apps.

`packages/fcc-adapter` is the only boundary that should know how to talk to Flare FCC. The rest of c402 can run in credit-only mode while FCC is disabled.

## x402 Compatibility

c402 does not replace x402. It extends the same HTTP 402 idea:

- x402 answers: pay this HTTP resource.
- c402 Credit answers: finance this payment from a funded receivable, then repay automatically.
- c402 Compute answers: pay for private/verifiable work and return a signed compute receipt.

Agents should discover c402 services through the well-known/catalog endpoints, then follow the advertised route flow.
