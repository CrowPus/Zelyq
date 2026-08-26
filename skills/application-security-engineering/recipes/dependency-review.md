# Recipe: Dependency Review

## New dependency

Ask:
- Is dependency necessary?
- Is built-in/existing library sufficient?
- Is package actively maintained?
- Is publisher/repository expected?
- Does it execute install scripts?
- What transitive dependencies appear?
- What runtime privilege/data does it access?

## Vulnerability result

For a CVE/advisory determine:
- actual installed version;
- dependency path;
- shipped/runtime vs dev-only;
- vulnerable feature reachability when relevant;
- fix/upgrade;
- breaking-change impact.

## Remediation

Prefer:
- supported fixed version;
- removal/replacement;
- feature disablement/mitigation

over ignoring scanner output indefinitely.

Document accepted residual risk with expiry/owner.
