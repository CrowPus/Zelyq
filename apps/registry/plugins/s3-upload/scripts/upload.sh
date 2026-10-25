#!/usr/bin/env bash
# Uploads ZELYQ_INPUT_SOURCE to s3://ZELYQ_INPUT_BUCKET/ZELYQ_INPUT_PREFIX with the AWS CLI.
set -euo pipefail
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
export AWS_ACCESS_KEY_ID="$ZELYQ_INPUT_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$ZELYQ_INPUT_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$ZELYQ_INPUT_REGION"
prefix="$(expand "$ZELYQ_INPUT_PREFIX")"
target="s3://$ZELYQ_INPUT_BUCKET/${prefix#/}"
endpoint=()
if [ -n "${ZELYQ_INPUT_ENDPOINT:-}" ]; then endpoint=(--endpoint-url "$ZELYQ_INPUT_ENDPOINT"); fi
if [ ! -e "$ZELYQ_INPUT_SOURCE" ]; then
  echo "Nothing to upload: $ZELYQ_INPUT_SOURCE does not exist in the run's folder." >&2
  exit 1
fi
if [ -d "$ZELYQ_INPUT_SOURCE" ]; then
  extra=()
  if [ "$ZELYQ_INPUT_DELETE" = "true" ]; then extra=(--delete); fi
  aws "${endpoint[@]}" s3 sync "$ZELYQ_INPUT_SOURCE" "$target" "${extra[@]}" --no-progress
else
  aws "${endpoint[@]}" s3 cp "$ZELYQ_INPUT_SOURCE" "$target" --no-progress
fi
echo "Uploaded $ZELYQ_INPUT_SOURCE to $target."
