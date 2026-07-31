#!/usr/bin/env bash
set -euo pipefail

echo "Run this inside the official Flare FCC scaffold after copying the c402 CREDIT_SCORE handler."
echo "./scripts/pre-build.sh"
echo "./scripts/start-services.sh --chain coston2"
echo "./scripts/post-build.sh"
echo "./scripts/test.sh"
