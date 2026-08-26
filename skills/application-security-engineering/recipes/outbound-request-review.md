# Recipe: Outbound Request / SSRF Review

## Identify feature

Examples:
- webhook test;
- import URL;
- avatar fetch;
- preview;
- callback;
- PDF from URL.

## Define legitimate destination model

### Known partners
Prefer explicit allowlist.

### Arbitrary internet
Define prohibited networks and egress architecture.

## Review URL processing

- parser/library;
- scheme;
- host;
- port;
- resolution;
- redirects;
- credentials;
- proxy behavior.

## Defense layers

- application validation;
- network egress restrictions;
- cloud metadata hardening;
- timeouts/size limits.

## Validation

Use controlled test destinations representing:
- allowed external;
- prohibited internal class.

Do not contact unrelated sensitive infrastructure to prove a design flaw.
