# Standards and Research Map

This file records the external professional foundations used to shape this skill. It is not a claim that every project must conform to every standard.

## Software engineering discipline — IEEE SWEBOK v4.0a

Use for the overall lifecycle/body of knowledge:
- requirements;
- architecture/design;
- construction;
- testing;
- operations;
- maintenance;
- configuration management;
- management/process;
- quality;
- security;
- professional practice.

SWEBOK v4.0a is the latest IEEE Computer Society update referenced when this skill was authored.

Source: https://www.computer.org/education/bodies-of-knowledge/software-engineering

## Secure software lifecycle — NIST SSDF

Use for secure-development lifecycle thinking rather than treating security as a final penetration test.

Stable final baseline currently: NIST SP 800-218 SSDF v1.1. A v1.2 revision was in draft during 2026; do not silently treat a draft as a final compliance standard.

Source: https://csrc.nist.gov/projects/ssdf

## Application security — OWASP ASVS 5.0

Use as the verifiable application-security requirements baseline.

Source: https://owasp.org/www-project-application-security-verification-standard/

## Security awareness — OWASP Top 10:2025

Use for high-level risk awareness, especially:
- broken access control;
- security misconfiguration;
- software supply chain;
- cryptography;
- injection;
- insecure design;
- authentication;
- integrity;
- logging/alerting;
- exceptional-condition handling.

OWASP explicitly states Top 10 is not a comprehensive verification standard; prefer ASVS for engineering verification.

Source: https://owasp.org/Top10/2025/

## Accessibility — WCAG 2.2

Use for web accessibility requirements and verification.

Source: https://www.w3.org/TR/WCAG22/

## Search/SEO — Google Search Essentials

Use for Google-specific crawl/index/SEO engineering. Do not promise ranking.

Sources:
- https://developers.google.com/search/docs/essentials
- https://developers.google.com/search/docs/fundamentals/get-started-developers

## HTTP — RFC 9110

Use for HTTP method semantics, status codes, idempotency, caching/conditional behavior, and retry semantics.

Source: https://www.rfc-editor.org/rfc/rfc9110.html

## HTTP error details — RFC 9457

Use when a standard machine-readable Problem Details format fits an HTTP API.

Source: https://www.rfc-editor.org/rfc/rfc9457.html

## API description — OpenAPI Specification

Current published specification when authored: OpenAPI 3.2.0.

Source: https://spec.openapis.org/oas/latest.html

## Package public API compatibility — Semantic Versioning 2.0.0

Use when the project explicitly follows SemVer and has a declared public API.

Source: https://semver.org/

## Observability — OpenTelemetry

Use for trace/metric/log instrumentation concepts and standard telemetry conventions where applicable.

Source: https://opentelemetry.io/docs/concepts/observability-primer/

## Reliability — Google SRE

Use for practical reliability thinking including the four golden signals: latency, traffic, errors, saturation.

Source: https://sre.google/sre-book/monitoring-distributed-systems/

## Supply chain — SLSA 1.2

Use for progressively improving source/build provenance and build-system trust.

Source: https://slsa.dev/spec/v1.2/

## Service deployment conventions — Twelve-Factor App

Use selectively for service configuration, explicit dependencies, build/release/run separation, process/disposability, dev/prod parity, and logs. It is older guidance; do not treat every factor as modern law.

Source: https://12factor.net/

## Software delivery — DORA

Use for delivery-system outcomes, not as individual developer productivity metrics.

Current DORA model includes change lead time, deployment frequency, failed deployment recovery time, change failure rate, and deployment rework rate.

Source: https://dora.dev/insights/dora-metrics-history/

## Database concurrency example — PostgreSQL current docs

Use PostgreSQL documentation when the project uses PostgreSQL. Isolation/concurrency behavior is database-specific; do not generalize PostgreSQL semantics to every database.

Source: https://www.postgresql.org/docs/current/transaction-iso.html

## Currency of references

Standards evolve. When a task explicitly depends on compliance, exact version behavior, legal/regulatory requirements, or current vendor behavior, verify the current authoritative source rather than relying only on this bundled summary.
