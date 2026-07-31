# Flare FCC Coston2 Integration

The c402 Credit flow does not require FCC. The credit contract, receivable-backed underwriting checks, repayment router, x402 settlement, and ERC-8004 reputation signal can run on testnets while FCC is disabled.

FCC is the optional confidential-underwriting extension. It is needed only when private inputs must be evaluated inside a TEE and represented by a verifiable Compute Receipt. Live FCC is enabled by setting `C402_ENABLE_COMPUTE=true`, switching to `C402_FCC_MODE=coston2`, and pointing the API at a registered FCC proxy.

## Required Environment

```sh
C402_ENABLE_COMPUTE=true
C402_FCC_MODE=coston2
C402_FCC_PROXY_URL=https://your-public-proxy.example
C402_FCC_EXTENSION_ID=<registered extension id>
C402_FCC_TEE_ID=<registered tee id>
C402_EXPECTED_CODE_HASH=<docker image code hash registered on Coston2>
```

The official Coston2 `ext-proxy` also needs Flare indexer DB credentials in `flare-extension/scaffold/config/proxy/extension_proxy.coston2.docker.toml`:

```toml
[db]
host = "<indexer-db-host>"
port = 3306
database = "<indexer-db-name>"
username = "<indexer-db-user>"
password = "<indexer-db-password>"
```

Without those credentials, the FCC proxy cannot start, `/info` will not become healthy, and `post-build.sh` cannot register the TEE machine. This does not block the non-FCC c402 Credit path.

Use the Flare scaffold lifecycle for Coston2:

```sh
./scripts/pre-build.sh
./scripts/start-services.sh --chain coston2
./scripts/post-build.sh
./scripts/test.sh
```

The API refuses to quote work if the proxy attestation does not match the configured extension ID and code hash.

## Failure Boundaries

- Code hash mismatch: no quote is issued.
- Missing TEE signing or encryption key: no quote is issued.
- Invalid receipt signature: payment is not released.
- TEE timeout or failed receipt: payment is not released.
- Duplicate retry: cached receipt/result is returned without re-execution.
