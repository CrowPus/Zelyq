# Profile: High-Risk Functionality

Activate for authentication, authorization, admin actions, money/payments, secrets, sensitive personal data, file uploads, destructive operations, or high-value business workflows.

## Mandatory behavior

- explicitly identify assets and trust boundaries;
- do not infer authorization from UI visibility;
- fail closed on uncertain permission/integrity states;
- define replay/retry/concurrency behavior;
- negative-test permissions and malformed inputs;
- prevent sensitive error/log leakage;
- define audit/security telemetry where appropriate;
- avoid irreversible operations without confirmation/recovery policy;
- surface missing business/security requirements rather than inventing them.

## Payments/money

Require explicit:
- currency/precision/rounding;
- idempotency;
- provider webhook verification;
- reconciliation;
- terminal vs retryable failure;
- authorization and refund/reversal rules.

## Destructive admin action

Consider:
- scope confirmation;
- least privilege;
- re-authentication for highly sensitive actions when product policy requires it;
- audit event;
- reversible/soft-delete path where appropriate;
- asynchronous progress and partial failure for bulk operations.

Load security, privacy/data, data/concurrency, and observability.
