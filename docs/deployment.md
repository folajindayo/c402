# Deployment

Deploy the API and dashboard as normal Node services. Vercel, Fly.io, Render, Railway, or a small VPS are all acceptable. The API is stateful in the current implementation, so for public use run one instance or add a persistent database before horizontal scaling.

## Required Production Environment

```bash
C402_PUBLIC_URL=https://your-api.example
C402_CREDIT_ENDPOINT=https://your-api.example/credit
C402_CREDIT_CONTRACT=0x...
C402_CREDIT_NETWORK=eip155:84532
C402_CREDIT_RPC_URL=https://sepolia.base.org
C402_NETWORK=eip155:84532
C402_ASSET=0x036CbD53842c5426634e7929541eC2318f3dCF7e
C402_PAY_TO=0x...
X402_FACILITATOR_URL=https://x402.org/facilitator
C402_ENABLE_COMPUTE=false
X402_FLARE_NETWORK=eip155:114
X402_FLARE_RPC_URL=https://coston2-api.flare.network/ext/C/rpc
X402_FLARE_ASSET=0x21709E63fC7F264F329e0826Ea82197694B82775
X402_FLARE_FACILITATOR_URL=https://your-api.example/x402/flare-facilitator
```

Base Sepolia is the primary public testnet for c402 credit and default x402 payments. Flare Coston2 is available through c402's own x402 facilitator because the default public x402 facilitator does not advertise Coston2.

To enable Flare x402 settlement, add `X402_FLARE_FACILITATOR_PRIVATE_KEY` only in your host's secret manager. The key must control a Coston2-funded facilitator wallet.

## Optional FCC Environment

```bash
C402_ENABLE_COMPUTE=true
C402_FCC_MODE=coston2
C402_FCC_PROXY_URL=https://your-fcc-proxy.example
C402_FCC_EXTENSION_ID=0x...
C402_FCC_TEE_ID=0x...
C402_EXPECTED_CODE_HASH=0x...
```

## Build

```bash
npm ci
npm run build
forge build
```

## Docker

```bash
npm run docker:build
docker compose -f deploy/compose/compose.prod.yaml --env-file .env.production up -d --build
```

## Public Endpoints

- `GET /.well-known/c402.json`
- `GET /openapi.json`
- `GET /lenders`
- `POST /lenders/register`
- `POST /credit/jobs`
- `POST /credit/jobs/{jobId}/collateral`
- `POST /credit/request`
- `POST /credit/match`
- `POST /credit/offers/{offerId}/supplier-payment`
- `POST /credit/jobs/{jobId}/complete`
- `POST /credit/jobs/{jobId}/fail`
- `POST /credit/advances/{advanceId}/liquidate`
- `GET /x402/flare-facilitator/supported`
- `POST /x402/flare-facilitator/verify`
- `POST /x402/flare-facilitator/settle`
- `POST /credit-score` when FCC is enabled
