#!/usr/bin/env bash
# Copies ZELYQ_INPUT_SOURCE to ZELYQ_INPUT_USER@ZELYQ_INPUT_HOST:ZELYQ_INPUT_TARGET.
set -euo pipefail
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
printf '%s\n' "$ZELYQ_INPUT_KEY" > "$work/key"
chmod 600 "$work/key"
if [ -n "${ZELYQ_INPUT_KNOWN_HOSTS:-}" ]; then
  printf '%s\n' "$ZELYQ_INPUT_KNOWN_HOSTS" > "$work/known_hosts"
  checking=(-o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$work/known_hosts")
else
  checking=(-o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$work/known_hosts")
fi
if [ ! -e "$ZELYQ_INPUT_SOURCE" ]; then
  echo "Nothing to copy: $ZELYQ_INPUT_SOURCE does not exist in the run's folder." >&2
  exit 1
fi
ssh -i "$work/key" -p "$ZELYQ_INPUT_PORT" "${checking[@]}" -o BatchMode=yes \
  "$ZELYQ_INPUT_USER@$ZELYQ_INPUT_HOST" -- mkdir -p "$ZELYQ_INPUT_TARGET"
scp -i "$work/key" -P "$ZELYQ_INPUT_PORT" "${checking[@]}" -o BatchMode=yes -r \
  "$ZELYQ_INPUT_SOURCE" "$ZELYQ_INPUT_USER@$ZELYQ_INPUT_HOST:$ZELYQ_INPUT_TARGET/"
echo "Copied $ZELYQ_INPUT_SOURCE to $ZELYQ_INPUT_HOST:$ZELYQ_INPUT_TARGET."
