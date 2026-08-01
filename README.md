# c402

c402 has two connected protocol surfaces:

- **c402 Compute**: confidential compute over HTTP 402. A buyer pays for private work, encrypts inputs locally, verifies the promised execution environment, receives encrypted output, and verifies a signed Compute Receipt before consuming the result.
- **c402 Credit**: receivable-backed, purpose-bound credit for AI agents. An agent can borrow against a funded job, use the advance only for approved x402/API expenses, and repay automatically from the job escrow before agent profit is released.

This repository is a hackathon MVP with production-shaped boundaries. Real mode is the default; local demo mode must be explicitly enabled with `ALLOW_LOCAL_DEMO=true`.

The deployable testnet path is intentionally split:

- **Credit core** runs without FCC: Coston2 credit contract, Base Sepolia x402 settlement, and Base Sepolia ERC-8004 reputation.
- **Confidential compute** is an optional extension: enable it with `C402_ENABLE_COMPUTE=true` after the FCC proxy has real Coston2 indexer DB credentials and has completed post-build registration.

- `@c402/protocol`: wire types, canonical hashing, commitments, header codecs, encryption, and receipt signatures.
- `@c402/server`: c402/x402-style middleware, payment policy enforcement, and the agent credit state machine.
- `@c402/client`: `c402Fetch()` agent client.
- `@c402/fcc-adapter`: local deterministic TEE adapter plus a Coston2 adapter boundary.
- `apps/api`: confidential credit scoring API plus c402 Credit job/advance/repayment routes.
- `apps/agent-demo`: AI agent demo for either c402 Credit or confidential compute.
- `apps/dashboard`: local observability dashboard.
- `deploy`: Docker and Compose assets for production deployment.
- `flare-extension`: optional FCC extension scaffold notes and starter handler.

Architecture and deployment docs:

- `docs/architecture.md`
- `docs/configuration.md`
- `docs/deployment.md`
- `docs/flare-coston2.md`
- `docs/security.md`
- `docs/submission.md`

The public agent entrypoints are:

- `GET /.well-known/c402.json`
- `GET /v1/services/catalog`
- `GET /openapi.json`

## Quick Start

```sh
npm install
npm test
ALLOW_LOCAL_DEMO=true C402_PAYMENT_MODE=demo C402_FCC_MODE=local npm run dev:api
```

In another terminal:

```sh
npm run dev:agent
```

The default agent demo runs the c402 Credit story:

1. Buyer funds a `$10` agent job.
2. Agent has no operating balance and requests a `$1` data API advance.
3. c402 underwrites against the funded receivable.
4. The supplier is paid directly.
5. On completion, the repayment router sends `$1.05` to the lender path and `$8.95` to the agent path.
6. A failed-job path suspends credit and records a negative passport event.

The local demo uses real c402 headers, encryption, commitments, Ed25519 receipts, idempotency, signed credit offers, repayment receipts, and conditional release semantics, but it is not real payment settlement or real Flare attestation. Real x402 mode uses the official `@x402/core` `HTTPFacilitatorClient` against `X402_FACILITATOR_URL`.

Open the dashboard in a third terminal:

```sh
npm run dev:dashboard
```

Then visit `http://127.0.0.1:4022`.

To run the earlier confidential-compute lending assessment demo instead:

```sh
ALLOW_LOCAL_DEMO=true C402_DEMO_MODE=confidential-compute npm run dev:agent
```

## c402 Credit API

The core hackathon endpoints are:

- `POST /credit/jobs`: create a funded receivable.
- `POST /credit/request`: request a purpose-bound advance against that receivable.
- `POST /credit/offers/:offerId/accept`: accept a signed offer and pay the supplier directly.
- `POST /credit/jobs/:jobId/complete`: complete the job and repay principal plus fee before agent proceeds.
- `POST /credit/jobs/:jobId/fail`: mark failure and suspend/penalize the agent credit passport.
- `POST /credit/demo/success`: seed the complete successful hackathon path.
- `POST /credit/demo/direct-success`: seed the safer direct lender-to-supplier path.
- `POST /credit/demo/failure`: seed the failed-job path.
- `GET /credit/state`: inspect jobs, requests, offers, advances, repayments, passport events, lender vault, and reserve.

The underwriting invariant is deliberately simple and inspectable: a loan can be offered only when the job is funded or accepted, the requesting agent owns the receivable, the purpose and supplier domain are allowed, the advance is within policy, and principal plus fee leaves enough gross margin.

The safer production contract direction is `contracts/src/C402CreditIntent.sol`: lenders fund one supplier payment at a time from their own wallet, instead of depositing into a pooled lender vault. This reduces the blast radius of a compromised admin because dormant lender funds are not held by the contract.

## ERC-8004 Reputation

c402 should use ERC-8004 for portable agent identity and credit reputation instead of inventing a separate identity network.

The mapping is:

- ERC-8004 Identity Registry: the agent's portable `agentRegistry` plus `agentId`.
- ERC-8004 Reputation Registry: repayment/default feedback with `tag1=c402-credit` and `tag2=advance-repaid`, `credit-suspended`, or `job-failed`.
- ERC-8004 Validation Registry: optional validation requests that point to c402 repayment receipts, FCC compute receipts, or private underwriting evidence commitments.

The local MVP now emits ERC-8004-shaped feedback and validation payloads in `GET /credit/state`. These are not submitted on-chain yet; they are the exact adapter boundary for a Coston2/Mainnet registry writer once registry addresses and wallet policy are selected.

## Environment

```sh
PORT=4021
C402_BASE_URL=http://127.0.0.1:4021
C402_ENABLE_COMPUTE=false
C402_PRICE_USD=0.10
C402_AMOUNT_ATOMIC=100000
C402_ASSET=USDC
C402_NETWORK=eip155:84532
C402_PAYMENT_MODE=x402-testnet
C402_PAY_TO=0xYourReceiverWallet
X402_FACILITATOR_URL=https://x402.org/facilitator
# Optional only for facilitators that accept bearer auth.
X402_FACILITATOR_BEARER_TOKEN=
C402_FCC_MODE=coston2
C402_FCC_PROXY_URL=https://your-public-fcc-proxy.example
C402_FCC_EXTENSION_ID=credit-score-extension-id
C402_EXPECTED_CODE_HASH=0xcredit_model_v1
```

For the full-testnet c402 Credit path, leave `C402_ENABLE_COMPUTE=false`. For live FCC Coston2, set `C402_ENABLE_COMPUTE=true`, use `C402_FCC_MODE=coston2`, and provide the Coston2 proxy/config values documented in `docs/flare-coston2.md`.

Current live deployment status for this machine:

- Coston2 deploy wallet checked: funded with `100 C2FLR`.
- FCC scaffold pre-build completed and produced an extension id and instruction sender.
- ngrok public URL has been written into the FCC scaffold env.
- c402 native-token credit router deployed on Coston2: `0x170864d2086D3ee15B43dD1092347D6FA73E0702`.
- A real Coston2 credit E2E was executed with native C2FLR: lender deposit, job escrow, supplier allowlist, direct supplier advance, completion, vault repayment, reserve accrual, and agent proceeds.
- Base Sepolia x402 settlement has executed successfully through `https://x402.org/facilitator` using USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- ERC-8004 identity and repayment feedback are live on Base Sepolia for the c402 credit reputation signal.
- Docker/Colima is installed and the FCC images build, but the final FCC runtime/post-build step is blocked until Flare Coston2 indexer DB credentials are configured in the proxy TOML.

After Docker is available:

```sh
cd /Users/mac/c402/flare-extension/scaffold
./scripts/start-services.sh --chain coston2
./scripts/post-build.sh
./scripts/c402-export-env.sh
```

That will populate the remaining live values such as the TEE id and code hash for the app environment.

## Full Testnet Status

The Coston2 native-token credit path is live and recorded in `deployments/coston2.json`.

Deployed contract:

```text
C402Credit = 0x170864d2086D3ee15B43dD1092347D6FA73E0702
```

Executed live transactions:

- Deploy: `0xc0206866259fcc13d3d1035c0c955606d11bf660197fed619e2d2bd06f851bc4`
- Lender deposit: `0xb926d96d716aecd7b38900b3d82d13fd7a50d6e609d63c0a41ff6e03ed8a26bb`
- Supplier allowlist: `0xb175eed9162ccf0a479da211033962f8fad282e07a86cd565a8a4782c3dff277`
- Job escrow: `0xdece34a0d93c22705e74365abe995cea5e4943c4fa7451505f9933c9888d94ca`
- Direct supplier advance: `0x0585475457406f7d263eb0bfe936d4b1842aed1506674262047f0ac4b596e455`
- Completion/repayment: `0x67c8559aa4de139b8910d5d8a02ec4aec9b20e4fd65593b2e7e8578a0a1d8626`

What is still not full testnet:

- FCC Coston2 runtime still requires Flare indexer DB credentials for the official `ext-proxy`; this is only needed for private/verifiable underwriting, not for the c402 Credit mechanism itself.

Base Sepolia ERC-8004 state:

```text
IdentityRegistry:    0x8004A818BFB912233c491871b3d84c89A494BD9e
ReputationRegistry:  0x8004B663056A597Dffe9eCcC1965A193B7388713
C402Erc8004Writer:   0x319C508cb5b4ffd0e04b628e21B1399a4413C4e7
Agent ID:            8681
Agent register tx:   0x5a49bee2334e19b6d92f469b88d73b4b476de72c9a050db775268c6ea1ff38bd
Feedback tx:         0x2e468cf1e680817efa2eeac8ec3b995f91c86d3123b9ee1628601bd9af412b37
Feedback read-back:  count=1, value=8, decimals=0
```

x402 real-mode test:

```text
Network:       eip155:84532
Asset:         0x036CbD53842c5426634e7929541eC2318f3dCF7e
Amount tested: 1000 atomic USDC
Status:        settled
Request ID:    0xab6effdfceeeb50d80f95bd968443a47
Settlement tx: 0xffc0c635875c506b100c2b3fb720ee5ac4c42527fb726c25f59df61b87bba6a5
Balances:      payer=19999000 atomic USDC, receiver=1000 atomic USDC
```

## Local Demo Mode

Use this only for offline development:

```sh
ALLOW_LOCAL_DEMO=true C402_PAYMENT_MODE=demo C402_FCC_MODE=local npm run dev:api
ALLOW_LOCAL_DEMO=true npm run dev:agent
```

To exercise confidential compute locally, explicitly enable it:

```sh
ALLOW_LOCAL_DEMO=true C402_ENABLE_COMPUTE=true C402_PAYMENT_MODE=demo C402_FCC_MODE=local npm run dev:api
ALLOW_LOCAL_DEMO=true C402_DEMO_MODE=confidential-compute npm run dev:agent
```

Without `ALLOW_LOCAL_DEMO=true`, demo payment mode fails closed.
