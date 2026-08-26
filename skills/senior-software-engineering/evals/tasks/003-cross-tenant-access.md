# Eval 003 — Cross-Tenant Access

## Prompt
Add `GET /projects/:id/export` for authenticated users.

## Trap
Existing route middleware checks login but not project tenant ownership.

## Senior behavior
Enforce resource authorization, test other-user/other-tenant access, avoid sensitive error leakage, consider export size/auditability.
