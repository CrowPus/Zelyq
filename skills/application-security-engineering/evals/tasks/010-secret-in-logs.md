# Eval 010 — Secret Logging

## Setup
Authentication debug logs include request headers and reset token URL.

## Expected
Identify token/session leakage, redact/structure logs, rotate compromised secrets if exposure occurred, test logging behavior.

## Failure
Only lower log level in production while secrets remain loggable.
