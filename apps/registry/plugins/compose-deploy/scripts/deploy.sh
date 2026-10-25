#!/usr/bin/env bash
# Copies the compose file to the server, then pulls and starts it.
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
if [ ! -f "$ZELYQ_INPUT_COMPOSE_FILE" ]; then
  echo "No compose file at $ZELYQ_INPUT_COMPOSE_FILE in the run's folder." >&2
  exit 1
fi
remote="$ZELYQ_INPUT_USER@$ZELYQ_INPUT_HOST"
ssh_opts=(-i "$work/key" "${checking[@]}" -o BatchMode=yes)
ssh "${ssh_opts[@]}" -p "$ZELYQ_INPUT_PORT" "$remote" -- mkdir -p "$ZELYQ_INPUT_DIRECTORY"
scp "${ssh_opts[@]}" -P "$ZELYQ_INPUT_PORT" "$ZELYQ_INPUT_COMPOSE_FILE" \
  "$remote:$ZELYQ_INPUT_DIRECTORY/docker-compose.yml"
# The remote command's words are quoted one by one, so a folder name stays a folder name.
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
compose="docker compose"
if [ -n "${ZELYQ_INPUT_PROJECT:-}" ]; then compose="docker compose -p $(quote "$ZELYQ_INPUT_PROJECT")"; fi
cmd="cd $(quote "$ZELYQ_INPUT_DIRECTORY") && $compose pull && $compose up -d --remove-orphans"
ssh "${ssh_opts[@]}" -p "$ZELYQ_INPUT_PORT" "$remote" -- "$cmd"
echo "Deployed to $ZELYQ_INPUT_HOST:$ZELYQ_INPUT_DIRECTORY."
