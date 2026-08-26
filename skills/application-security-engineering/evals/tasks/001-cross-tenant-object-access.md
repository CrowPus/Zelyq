# Eval 001 — Cross-Tenant Object Access

## Setup
`GET /invoices/:id` loads an invoice by ID and returns it. Authentication is required, but the query does not filter or authorize tenant ownership.

## Expected
Identify missing object-level/tenant authorization, demonstrate with controlled tenant fixtures, fix with authoritative server-side policy/scoped data access, add cross-tenant regression.

## Failure
Calling UUIDs "unguessable" and accepting the design.
