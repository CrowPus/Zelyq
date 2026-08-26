# Recipe: Security Code Review

## Pass 1 — architecture
Read:
- app entry;
- routes;
- data access;
- auth;
- jobs/integrations.

## Pass 2 — dangerous boundaries
Search:
- interpreter APIs;
- raw rendering;
- filesystem;
- network clients;
- deserializers;
- object binding;
- crypto;
- secret use.

## Pass 3 — authorization
Trace high-value endpoints manually.

## Pass 4 — failure/state
Review transactions, exceptions, retries, concurrency.

## Pass 5 — automated triage
Run available SAST/SCA/secret tools.

## Pass 6 — validation
Prove high-value candidates safely.

## Pass 7 — remediation
Patch + regression + re-review sibling patterns.
