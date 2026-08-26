# Security Engineering

## Scope

Security is not a final scan. It is requirements, design, implementation, verification, dependency management, deployment, and incident visibility.

Use OWASP ASVS 5.0 as a verifiable application-security baseline. OWASP itself recommends ASVS rather than claiming the Top 10 is comprehensive. NIST SSDF provides lifecycle-level secure software-development practices.

## Start with trust boundaries

Identify:
- anonymous user;
- authenticated user;
- privileged/admin user;
- tenant boundaries;
- internal services;
- third-party services;
- database/storage;
- browser/client;
- build/deployment systems.

Any data crossing a trust boundary must be treated according to the receiver's security requirements.

## Authentication

Consider:
- credential storage using established password hashing mechanisms;
- MFA/strong auth where risk requires it;
- session/token expiration;
- reset/recovery abuse;
- brute force/rate limiting;
- credential enumeration;
- token revocation/rotation;
- secure cookie attributes where cookie-based;
- avoiding credentials in URLs/logs.

Do not design custom cryptographic authentication schemes when established standards/libraries exist.

## Authorization

Authorization must be enforced at the server/resource boundary.

Check:
- object ownership;
- tenant isolation;
- role/permission matrix;
- indirect object references;
- admin-only endpoints;
- bulk operations;
- background jobs acting on behalf of users;
- exported/downloaded resources.

Never assume hidden UI equals denied access.

## Input validation and injection

Validate data by expected structure/type/range at trust boundaries.

Prefer:
- parameterized SQL/database APIs;
- structured command APIs rather than shell concatenation;
- contextual output encoding;
- allowlists for constrained values;
- safe parsers.

Sanitization is not a universal replacement for validation/encoding.

## Secrets

Never place secrets in:
- source control;
- client bundles;
- URLs;
- test snapshots;
- ordinary logs;
- stack traces returned to clients.

Use platform secret/config mechanisms and least-privilege credentials.

## Data protection

Classify sensitive data. Minimize collection and exposure.

Protect data:
- in transit using current secure transport;
- at rest according to sensitivity and platform threat model;
- in logs/telemetry;
- in exports/backups;
- in lower environments.

Do not invent cryptography. Use established libraries and platform capabilities.

## File upload

Uploads require explicit handling of:
- size limits;
- allowed types/extensions;
- MIME/content mismatch;
- filename/path traversal;
- storage isolation;
- authorization;
- malware/content scanning where risk justifies it;
- public/private serving policy;
- decompression bombs/archive traversal;
- image/document parser risk;
- cleanup of abandoned files.

Never trust the browser-provided filename or MIME type as proof.

## SSRF / outbound requests

When user-controlled input influences outbound network access consider:
- scheme allowlist;
- host/domain allowlist;
- redirects;
- private/link-local/cloud-metadata addresses;
- DNS rebinding concerns;
- request size/time limits.

## Business-logic abuse

Security is also domain correctness.

Ask:
- can discounts stack illegally?
- can limits be bypassed with parallel requests?
- can a workflow step be skipped?
- can a resource be transferred twice?
- can negative/overflow values change money/credits?
- can expensive operations be triggered without quotas?

## Error handling

OWASP Top 10:2025's exceptional-condition guidance emphasizes failing securely, transaction rollback, central error handling, logging/monitoring, limits, and avoiding sensitive error disclosure.

Client responses should not contain stack traces, database errors, internal paths, secret values, or detailed security policy internals.

## Security logging

Log security-relevant outcomes such as:
- auth failures/success where appropriate;
- access-denied events;
- privilege changes;
- sensitive configuration changes;
- suspicious rate/validation patterns;
- destructive admin operations.

Protect logs themselves from sensitive-data leakage and unauthorized access.

## Supply chain

Consider:
- lockfiles/reproducible dependency resolution;
- dependency provenance;
- vulnerable/outdated packages;
- typosquatting/package confusion;
- CI token permissions;
- build artifact provenance/signing when risk justifies it;
- untrusted install/build scripts.

See `config-secrets-and-supply-chain.md`.

## Threat-model prompts

For a feature ask:
1. What assets matter?
2. Who could misuse it?
3. Through which entry points?
4. What authorization boundary exists?
5. What happens if input is hostile?
6. What happens if a dependency is compromised?
7. What is the worst plausible business impact?
8. Which controls prevent/detect/recover?

## Verification

Security-relevant features need negative tests, not only successful auth tests.

Test:
- unauthorized;
- wrong tenant;
- expired credentials;
- malformed input;
- replay/retry;
- rate/size limits;
- error leakage;
- dangerous file/input types;
- privilege transitions.

## Sources

- OWASP ASVS 5.0: https://owasp.org/www-project-application-security-verification-standard/
- OWASP Top 10:2025: https://owasp.org/Top10/2025/
- NIST SSDF: https://csrc.nist.gov/projects/ssdf
