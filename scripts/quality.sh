#!/usr/bin/env bash
# Runs the page-quality suite (accessibility, screenshots, speed) the way CI
# does: inside the Playwright container, so fonts and the browser build match
# and a screenshot taken here compares cleanly there.
#
#   scripts/quality.sh            check, like CI
#   scripts/quality.sh --update   take new screenshots, to commit with a change
#                                 that is meant to alter a page
#
# Needs Docker, and a build first (pnpm build). Uses this machine's Node, so
# the installed packages (built for it) load inside the container too.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="mcr.microsoft.com/playwright:v$(node -p "require('@playwright/test/package.json').version")-noble"
NODE_DIR="$(dirname "$(dirname "$(command -v node)")")"
COREPACK_CACHE="${COREPACK_HOME:-$HOME/.cache/node/corepack}"
ARGS=()
[[ "${1:-}" == "--update" ]] && ARGS+=(--update-snapshots)

# A fresh database each time: the pages must look the same on every run.
rm -rf .playwright

docker run --rm --init --ipc=host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/home -e CI="${CI:-}" \
  -e COREPACK_HOME=/tmp/corepack \
  -v "$NODE_DIR:/opt/node:ro" \
  -v "$COREPACK_CACHE:/tmp/corepack" \
  -v "$PWD:$PWD" -w "$PWD" \
  "$IMAGE" \
  bash -c 'export PATH=/opt/node/bin:$PATH; mkdir -p $HOME; node node_modules/@playwright/test/cli.js test -c playwright.quality.config.ts "$@"' \
  _ "${ARGS[@]}"
