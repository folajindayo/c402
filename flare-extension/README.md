# c402 FCC Credit Extension

This folder contains the c402 Coston2 extension boundary. Use it with the current official Flare FCC tooling and wire the handler into the proxy `/action` endpoint.

- `OP_TYPE`: `CREDIT_SCORE`
- `OP_COMMAND`: `ASSESS`
- payload: c402 `ComputePayload`
- result: encrypted c402 output plus signed `ComputeReceipt`

The API-side adapter in `packages/fcc-adapter` expects the proxy to expose `/info` for attestation metadata and `/action` for execution.
