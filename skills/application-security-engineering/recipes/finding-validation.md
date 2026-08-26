# Recipe: Finding Validation

## Candidate
State the hypothesis narrowly.

Example:
"User A may be able to read User B's invoice by changing invoice ID."

## Evidence chain

1. controlled input;
2. reachable code/endpoint;
3. missing/broken control;
4. security-sensitive sink/result;
5. demonstrated unauthorized effect.

## Lowest-impact proof

Prefer test fixtures or local environment.

## Negative control

Test expected authorized behavior too.

This helps distinguish:
- application broken generally;
- security boundary specifically broken.

## Independent confirmation

For high severity:
- second reviewer/agent;
- alternate route/code confirmation;
- regression test.

## Close if unsupported

Record why a candidate is not valid:
- framework safely encodes;
- permission enforced downstream;
- path unreachable;
- vulnerable dependency feature unused.

Do not keep "maybe" findings as vulnerabilities.
