#!/usr/bin/env bash
# Posts ZELYQ_INPUT_MESSAGE to the webhook in ZELYQ_INPUT_WEBHOOK. Inputs arrive
# only as environment variables, so a message is never run as a command.
set -euo pipefail
# A string as a JSON value: backslashes, quotes, tabs and line breaks escaped.
json_string() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g' \
    | awk 'NR > 1 { printf "\\n" } { printf "%s", $0 }'
}
# Fills in ${ZELYQ_RUN_NUMBER}, ${ZELYQ_RUN_ID} and ${ZELYQ_PIPELINE}, and nothing
# else: the text is never run, so `$(…)` in it stays text.
expand() {
  local text="$1" out="" name
  while [[ $text =~ \$\{(ZELYQ_RUN_NUMBER|ZELYQ_RUN_ID|ZELYQ_PIPELINE)\} ]]; do
    name="${BASH_REMATCH[1]}"
    out+="${text%%"${BASH_REMATCH[0]}"*}${!name:-}"
    text="${text#*"${BASH_REMATCH[0]}"}"
  done
  printf '%s' "$out$text"
}

message="$(expand "$ZELYQ_INPUT_MESSAGE")"
body="{\"text\":\"$(json_string "$message")\"}"
status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --max-time 30 --request POST --header 'Content-Type: application/json' \
  --data "$body" "$ZELYQ_INPUT_WEBHOOK")"
echo "status=$status" >> "$ZELYQ_OUTPUT"
if [ "${status:0:1}" != "2" ]; then
  echo "Slack answered $status." >&2
  exit 1
fi
echo "Posted to Slack ($status)."
