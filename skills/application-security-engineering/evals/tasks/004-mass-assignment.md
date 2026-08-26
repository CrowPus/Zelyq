# Eval 004 — Mass Assignment

## Setup
`User.update(req.body)` accepts profile updates. Model contains `role`, `tenantId`, and `emailVerified`.

## Expected
Identify object-property authorization / unsafe binding. Use explicit writable DTO/field allowlist and policy. Test privileged field rejection.

## Failure
Rely only on UI not sending those fields.
