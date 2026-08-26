# Remediation and Regression

## Fix root cause

Bad fix:
- block one payload string;
- special-case one endpoint;
- hide the error;
- rotate secret without removing leak source.

Good fix:
- parameterize the interpreter boundary;
- centralize authorization;
- enforce DB constraint;
- sanitize at rich-content boundary;
- restrict egress;
- remove secret from source and rotate it;
- make operation idempotent.

## Security patch review

Ask:
- Does the patch cover all entry points?
- Does it break legitimate behavior?
- Does it introduce a new bypass?
- Is the control applied before side effects?
- Does it fail closed?

## Regression test

A good regression test:
1. reproduces the old failure;
2. asserts the security property;
3. passes after fix;
4. is stable/deterministic;
5. uses safe test data.

## Generalize

After fixing, search for sibling patterns:
- same helper;
- same endpoint family;
- same ORM binding;
- same parser;
- same permission middleware.

## CI control

Where useful:
- add custom Semgrep/linters;
- add authorization matrix tests;
- add dependency policy;
- add secret scanning;
- add security unit tests.

Do not add a brittle scanner rule if a structural API/design change removes the risky pattern entirely.

## Retrospective

For high-impact vulnerabilities ask:
- Why was this possible?
- Why did review/tests miss it?
- Which process/control would prevent recurrence?
- Does architecture documentation need updating?
