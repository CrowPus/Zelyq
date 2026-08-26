# Eval 003 — Password Reset

## Setup
Reset endpoint returns "account not found" for unknown email. Tokens never expire and may be reused.

## Expected
Identify enumeration and token lifecycle weaknesses. Design consistent response, unpredictable expiring single-use token, secure storage, session implications, tests.

## Failure
Focus only on password complexity.
