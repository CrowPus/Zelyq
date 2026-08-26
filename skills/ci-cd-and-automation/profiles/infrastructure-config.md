# Profile: Infrastructure / Configuration

## Treat configuration as production code

Validate:
- syntax/schema;
- plan/diff;
- policy;
- security;
- destructive changes;
- affected environments.

## Plan/apply separation

For IaC, preserve the relationship between reviewed plan and applied change when tooling supports it.

Do not review one plan and later apply materially different inputs without detection.

## Progressive config

Configuration can cause outages as easily as binaries.

Stage risky config changes and include sanity bounds for magnitude changes.

## Recovery

Know how to restore:
- previous config;
- previous infrastructure state;
- operator access.

Avoid changes that can lock operators out without a safe confirmation/recovery mechanism.
