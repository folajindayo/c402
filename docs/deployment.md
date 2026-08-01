# Deploy c402 Credit

This is the production path for the working c402 Credit product. It does not require FCC. FCC remains an optional confidential-underwriting upgrade after Flare provides Coston2 indexer DB credentials.

## What Gets Deployed

- `api`: c402 Credit HTTP API with discovery metadata.
- `dashboard`: read-only observability UI.
- Existing live testnet contracts remain onchain:
  - Coston2 `C402Credit`: `0x170864d2086D3ee15B43dD1092347D6FA73E0702`
  - Base Sepolia ERC-8004 writer: `0x319C508cb5b4ffd0e04b628e21B1399a4413C4e7`
  - Base Sepolia x402 receiver: `0x21b805BBC4bfFA7769868BF7f488D77b71756d3E`

## Required Environment

Create `.env.production` from `.env.production.example`:

```sh
cp .env.production.example .env.production
```

For the credit product, keep:

```sh
C402_ENABLE_COMPUTE=false
C402_PAYMENT_MODE=x402-testnet
C402_NETWORK=eip155:84532
C402_ASSET=0x036CbD53842c5426634e7929541eC2318f3dCF7e
C402_PAY_TO=0x21b805BBC4bfFA7769868BF7f488D77b71756d3E
X402_FACILITATOR_URL=https://x402.org/facilitator
C402_PUBLIC_URL=https://api.your-domain.example
```

`C402_PUBLIC_URL` must be the final public HTTPS URL for the API, not the dashboard URL.

## Run With Docker Compose

```sh
docker compose -f deploy/compose/compose.prod.yaml --env-file .env.production up -d --build
```

Equivalent npm script:

```sh
npm run deploy:compose
```

Health checks:

```sh
curl https://api.your-domain.example/health
curl https://api.your-domain.example/.well-known/c402.json
curl https://api.your-domain.example/openapi.json
```

## Recommended Host

For the API, use **Fly.io** or **Railway** first. Both are a better fit than Vercel for this repository because the API and dashboard are already packaged as long-running Docker services.

Vercel can work for a dashboard or a serverless wrapper, but it is not the cleanest first deployment target for this product. c402 needs always-on API routes, simple Docker deployment, Web/API callbacks, and later a separate FCC proxy/TEE runtime. Use Vercel only for a frontend mirror or marketing page.

Fly.io quick path:

```sh
cp deploy/fly/api.fly.toml.example fly.toml
fly launch --no-deploy
fly secrets set C402_PUBLIC_URL=https://<your-api-app>.fly.dev
fly secrets set C402_PAY_TO=0xYourReceiverWallet
fly deploy
```

For the dashboard, deploy a second Fly app using `deploy/fly/dashboard.fly.toml.example` and set `C402_BASE_URL` to the API URL.

Railway is also fine: create two services from GitHub, point each service at the relevant Dockerfile, and set the same environment variables in Railway Variables.

## Put It Behind HTTPS

Use any normal HTTPS reverse proxy:

- Caddy
- Nginx
- Cloudflare Tunnel
- Fly.io
- Railway
- Render
- a VPS with Docker Compose

Route:

- `https://api.your-domain.example` -> container `api:4021`
- `https://dashboard.your-domain.example` -> container `dashboard:4022`

## Agent Discovery

Agents should start from:

```text
GET /.well-known/c402.json
GET /v1/services/catalog
GET /openapi.json
```

The catalog declares:

- credit endpoints
- x402/FCC compute endpoint status
- live testnet contract addresses
- payment asset/network/receiver
- ERC-8004 agent id

## Agent Usage Flow

1. `POST /credit/jobs` to create a funded receivable.
2. `POST /credit/request` to request an advance against that job.
3. If approved, `POST /credit/offers/{offerId}/accept`.
4. On successful work, `POST /credit/jobs/{jobId}/complete`.
5. On failed work, `POST /credit/jobs/{jobId}/fail`.

## FCC Upgrade Later

After Flare provides indexer DB/VPN credentials:

1. Fill `flare-extension/scaffold/config/proxy/extension_proxy.coston2.docker.toml`.
2. Run the FCC scaffold:

```sh
cd flare-extension/scaffold
./scripts/start-services.sh --chain coston2
./scripts/post-build.sh
./scripts/c402-export-env.sh
```

3. Update `.env.production` with exported FCC values.
4. Set:

```sh
C402_ENABLE_COMPUTE=true
```

5. Redeploy the API.
