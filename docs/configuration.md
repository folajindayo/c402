# Configuration and Secrets

The repository must not contain private keys, RPC secrets, database URLs, bearer tokens, tunnel URLs, or local `.env` files. Public contract addresses, public transaction hashes, public token addresses, and placeholder examples are safe to commit.

## Committed Files

Committed examples:

- `.env.production.example`

These files must use placeholders for secrets.

## Ignored Local Files

Local runtime files are ignored by `.gitignore`:

- `.env`
- `.env.*`
- build outputs, caches, logs, `node_modules`, and generated contract artifacts

## Production Credit Mode

Use `.env.production` locally or on the server. Keep FCC disabled until the FCC proxy is fully registered.

```sh
C402_ENABLE_COMPUTE=false
C402_PUBLIC_URL=https://api.your-domain.example
C402_CREDIT_ENDPOINT=https://api.your-domain.example/credit
C402_NETWORK=eip155:84532
C402_ASSET=0x036CbD53842c5426634e7929541eC2318f3dCF7e
C402_PAY_TO=0xYourReceiverWallet
X402_FACILITATOR_URL=https://x402.org/facilitator
```

## Optional FCC Mode

FCC needs private local config:

```sh
C402_ENABLE_COMPUTE=true
C402_FCC_MODE=coston2
C402_FCC_PROXY_URL=https://your-public-fcc-proxy.example
C402_FCC_EXTENSION_ID=<registered-extension-id>
C402_FCC_TEE_ID=<registered-tee-id>
C402_EXPECTED_CODE_HASH=<registered-code-hash>
```

Copy FCC values only into your private deployment environment or hosting secret manager.

## Private Keys

Private keys must be provided only through private environment files or the deployment provider's secret manager:

- `DEPLOYMENT_PRIVATE_KEY`
- `PROXY_PRIVATE_KEY`
- `X402_PAYER_PRIVATE_KEY`
- `FUNDED_TEST_PRIVATE_KEY`
- `EXTENSION_OWNER_KEY`

Rotate any key that has ever been pasted into chat or terminal logs.
