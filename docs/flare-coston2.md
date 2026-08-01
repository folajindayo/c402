# Flare Coston2 FCC

FCC is optional for c402 Credit. The credit flow works without it when `C402_ENABLE_COMPUTE=false`.

Enable FCC when the product needs private underwriting, private scoring, or confidential AI execution.

Required values:

```bash
C402_ENABLE_COMPUTE=true
C402_FCC_MODE=coston2
C402_FCC_PROXY_URL=https://your-fcc-proxy.example
C402_FCC_EXTENSION_ID=0x...
C402_FCC_TEE_ID=0x...
C402_EXPECTED_CODE_HASH=0x...
```

The API refuses to quote `/credit-score` if the proxy attestation does not match the configured extension ID and code hash.

The repository keeps the c402 extension source in `flare-extension/extension-tee`. Deployment should use the current official Flare FCC tooling and a Coston2-funded deployment wallet. Keep proxy credentials and deployment private keys outside git.
