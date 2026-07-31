# c402 FCC Credit Extension

This folder is the live Coston2 extension boundary. Start from Flare's FCC scaffold, then replace the Hello World operation with:

- `OP_TYPE`: `CREDIT_SCORE`
- `OP_COMMAND`: `ASSESS`
- payload: c402 `ComputePayload`
- result: encrypted c402 output plus signed `ComputeReceipt`

The TypeScript local adapter in `packages/fcc-adapter` is the executable reference for the expected behavior. The Go handler in `extension-tee/main.go` documents the handler contract and should be wired into the official Flare scaffold's `/action` endpoint.
