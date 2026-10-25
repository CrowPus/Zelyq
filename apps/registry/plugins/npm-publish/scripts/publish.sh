#!/usr/bin/env bash
# Publishes the package with a token that lives only in a temporary .npmrc.
set -euo pipefail
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
host="${ZELYQ_INPUT_REGISTRY#*://}"
host="${host%/}/"
printf '//%s:_authToken=%s\nregistry=%s\n' "$host" "$ZELYQ_INPUT_TOKEN" "$ZELYQ_INPUT_REGISTRY" > "$work/npmrc"
cd "$ZELYQ_INPUT_DIRECTORY"
version="$(node -p "require('./package.json').version" 2>/dev/null || true)"
args=(publish --tag "$ZELYQ_INPUT_TAG" --access "$ZELYQ_INPUT_ACCESS" --userconfig "$work/npmrc")
if [ "$ZELYQ_INPUT_DRY_RUN" = "true" ]; then args+=(--dry-run); fi
npm "${args[@]}"
echo "version=$version" >> "$ZELYQ_OUTPUT"
echo "Published ${version:-the package} under $ZELYQ_INPUT_TAG."
