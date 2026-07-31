#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f config/extension.env ]]; then
  echo "config/extension.env is missing. Run ./scripts/pre-build.sh first." >&2
  exit 1
fi

source .env
source config/extension.env

INFO_JSON="$(curl -fsS "$EXT_PROXY_URL/info")"
CODE_HASH="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); console.log(j.machineData?.codeHash || "")' <<<"$INFO_JSON")"
TEE_ID="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); console.log(j.machineData?.teeId || j.machineData?.address || "")' <<<"$INFO_JSON")"

cat > ../../.env.production.example <<EOF
C402_PAYMENT_MODE=x402-testnet
C402_PAY_TO=0x21b805BBC4bfFA7769868BF7f488D77b71756d3E
X402_FACILITATOR_URL=https://x402.org/facilitator
C402_NETWORK=eip155:84532
C402_AMOUNT_ATOMIC=100000
C402_ASSET=USDC

C402_FCC_MODE=coston2
C402_FCC_PROXY_URL=$EXT_PROXY_URL
C402_FCC_EXTENSION_ID=$EXTENSION_ID
C402_FCC_TEE_ID=$TEE_ID
C402_EXPECTED_CODE_HASH=$CODE_HASH
EOF

echo "Wrote ../../.env.production.example with live FCC values."
