# Error Handling and Security Logging

## Fail safely

Security-sensitive exceptions should not:
- grant access;
- skip authorization;
- silently commit partial privileged state;
- return success when validation failed.

## User errors vs internal errors

External responses should be useful without leaking:
- stack traces;
- SQL;
- secrets;
- internal paths;
- infrastructure identifiers beyond what is needed.

Internal logs can hold diagnostic context with appropriate protection.

## Logging goals

OWASP recommends application security logging because infrastructure logs alone lack business/security context.

Consider logging:
- auth success/failure as appropriate;
- authorization failures;
- account recovery/security changes;
- privileged mutations;
- sensitive exports;
- repeated high-confidence validation failures;
- integrity/security-control failures.

## Never log

Avoid:
- plaintext passwords;
- access/refresh tokens;
- session IDs/secrets;
- private keys;
- payment secrets;
- unnecessary PII.

Mask/hash/tokenize identifiers where appropriate.

## Log integrity

Treat log input as untrusted.

Prevent log injection/forging.

Protect logs from unauthorized modification/deletion.

## Availability

Logging failure should not normally crash the application or become a way to fill disk indefinitely.

Test:
- collector unavailable;
- disk quota;
- serialization error;
- extreme event volume.

## Detection

A logged event without monitoring may not help.

For high-risk controls, define who/what detects repeated failure and how it becomes actionable.
