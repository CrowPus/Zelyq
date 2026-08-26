# Configuration, Secrets, Dependencies, and Supply Chain

## Configuration

Separate deploy-specific configuration from source code where appropriate.

The Twelve-Factor App recommends configuration in the environment and explicit dependency declaration; modern platforms may use environment variables, mounted files, secret stores, or configuration services.

Whatever mechanism exists, ensure:
- configuration is explicit;
- required values fail clearly at startup/deploy time;
- defaults are safe;
- secrets are not committed;
- config differences between environments are understood.

## Configuration validation

Validate config schema:
- missing required values;
- invalid URL/enum/number;
- conflicting flags;
- unsafe production defaults.

Prefer failing fast to running with silently invalid security/data settings.

## Secrets

Use platform secret-management capabilities.

Plan:
- least privilege;
- rotation;
- expiration;
- revocation;
- environment isolation;
- CI access scope.

Never expose server secrets to frontend build-time variables unless they are intentionally public.

## Dependencies

Keep:
- manifest;
- lockfile when ecosystem supports it;
- explicit versions/ranges;
- repeatable install/build process.

Before adding a dependency assess maintenance, license constraints if relevant, security history, transitive footprint, and replacement cost.

## Vulnerabilities

Use ecosystem/dependency scanning where available, but triage findings based on exploitability and project context.

Do not ignore known critical vulnerabilities simply because the feature works.

## Supply-chain integrity

OWASP Top 10:2025 explicitly includes Software Supply Chain Failures.

SLSA 1.2 provides a framework for progressively increasing source/build provenance and build-system security.

For mature/high-risk release pipelines consider:
- protected source/review controls;
- hosted/hardened build environment;
- least-privilege CI tokens;
- artifact provenance;
- signatures/verification;
- SBOM where ecosystem/customers require it;
- pinning third-party CI actions/build tools appropriately.

## Build/release/run separation

Build artifacts should be identifiable and releaseable predictably. Avoid rebuilding different artifacts for each production instance when one immutable artifact plus configuration is sufficient.

## Development/production parity

Keep important service/runtime versions and behavior similar enough that local/staging verification predicts production.

Do not use an in-memory database locally if production-only SQL/transaction semantics are critical and never integration-tested against the real database engine.

## Sources

- NIST SSDF: https://csrc.nist.gov/projects/ssdf
- OWASP Top 10:2025: https://owasp.org/Top10/2025/
- SLSA 1.2: https://slsa.dev/spec/v1.2/
- Twelve-Factor App: https://12factor.net/
