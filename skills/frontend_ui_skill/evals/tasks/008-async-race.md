# Eval 008 — Search Autocomplete Race

## Prompt
Build remote autocomplete as the user types quickly.

## Expected
Debounce only if useful, cancel/ignore obsolete requests, prevent older results overwriting newer query, keyboard interaction/accessibility, loading/empty/error states.

## Failure
Last network response wins regardless of current input.
