# Profile: White-Box Repository

## Goal

Use source context to find real security flaws efficiently and to fix them correctly.

## Required approach

1. map architecture and entry points;
2. identify auth/authz and trust boundaries;
3. run structural/static baseline;
4. manually review high-risk flows;
5. correlate findings with tests/runtime;
6. validate safely;
7. patch root cause;
8. add regression test;
9. re-run security baseline and relevant tests.

## Minimum review surfaces

When applicable:
- route/handler registration;
- authentication middleware;
- authorization helpers;
- ORM/data-access layer;
- request binding/validation;
- rendering/template/raw HTML;
- file upload/download;
- outbound HTTP clients;
- command/process execution;
- serialization/deserialization;
- secrets/config;
- background jobs;
- logging/errors.

## Tools

Prefer existing project/language tooling.

Useful general tools when installed:
- Semgrep;
- gitleaks;
- Trivy filesystem scanning;
- language package audit/SCA;
- AST-aware search.

Do not automatically install a huge toolchain into the project.

## Dynamic validation

Run locally/test environment where practical.

Do not conclude "not exploitable" solely because the application is hard to start. Increase static confidence and clearly state validation limitations.
