# Profile: Multi-Tenant SaaS

## Primary invariant

No tenant can read, modify, execute, or infer protected information/actions belonging to another tenant unless explicitly authorized.

## Review all paths

Not just CRUD:
- search;
- exports;
- notifications;
- files;
- caches;
- analytics;
- jobs;
- webhooks;
- audit logs;
- admin/support;
- integrations.

## Tenant context

Prefer deriving tenant context from authenticated membership/session rather than accepting arbitrary tenant IDs as authority.

## Data access

Use scoped repository/query APIs so forgetting the tenant predicate is hard.

Defense in depth may include:
- database RLS;
- separate schemas/databases;
- policy layer;
depending on architecture.

## Tests

Maintain cross-tenant regression fixtures.

A feature is not done until both allowed and denied tenant cases are tested.
