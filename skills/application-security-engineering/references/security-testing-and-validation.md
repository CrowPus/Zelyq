# Security Testing and Validation

## Balanced verification

OWASP WSTG recommends a balanced approach:
- manual inspection/design review;
- threat modeling;
- source review;
- automated scanning;
- penetration/dynamic testing.

No single technique is sufficient.

## Static analysis

Use SAST/structural tools to:
- locate risky APIs;
- find inconsistent controls;
- prioritize review.

Do not equate pattern match with exploitability.

## Secret scanning

Scan:
- current tree;
- history when appropriate;
- generated/config files.

A committed secret should be revoked/rotated even if removed from latest commit.

## Dependency scanning

Verify:
- package/version;
- dependency path;
- runtime relevance;
- fix;
- exposure.

## Dynamic validation

Use the least-impact test that proves the property.

Examples:
- authorization: attempt access to controlled object owned by another test principal;
- idempotency: duplicate controlled requests;
- exception handling: inject a controlled dependency failure in test environment;
- output encoding: render known harmless marker characters and inspect context.

Avoid unnecessary weaponized payloads if a benign reproducer proves the flaw.

## False positives

Close a candidate when:
- path unreachable;
- input is not attacker controlled;
- framework applies effective context-safe control;
- authorization occurs elsewhere reliably;
- dependency code not shipped/executed in affected context.

Document why.

## False negatives

Do not stop because scans are clean.

Manually review:
- authorization;
- tenant isolation;
- business logic;
- races;
- recovery;
- trust of third parties;
- exceptions.

## Independent confirmation

High-impact findings benefit from a second evidence path before escalation.

## Evidence preservation

Record enough to reproduce:
- version/commit;
- environment;
- role/account type;
- request/test;
- expected vs actual;
- affected object;
- logs/test output.

Do not store unnecessary secrets in evidence.
