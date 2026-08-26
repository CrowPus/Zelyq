# Multi-Tenancy and Isolation

## Principle

Tenant ID is a security boundary, not merely a query filter.

## Data model

Decide how tenant identity is represented:
- session/principal;
- database row;
- schema/database;
- service context.

Avoid trusting tenant identifiers solely from client request parameters.

## Query safety

Prefer data-access patterns that require tenant context.

Risky:
- fetching object globally then checking incompletely;
- optional tenant filter;
- admin bypass reused by ordinary code.

## Authorization

Test:
- same object ID other tenant;
- guessed/known UUID other tenant;
- list/search;
- exports;
- batch endpoints;
- nested child resources;
- file/download URLs;
- webhooks;
- background jobs;
- caches;
- analytics.

## Caches

Cache keys must include all security-relevant scope:
- tenant;
- user/role where needed;
- locale/version if behavior differs.

Cross-tenant cache collisions are data leaks.

## Background jobs

Carry trusted tenant context into the job.

Do not accept a queue message's tenant field as authoritative without validating its provenance/relationship.

## Admin/support

Impersonation or cross-tenant admin access should be:
- explicit;
- authorized;
- auditable;
- time/scope limited where practical.

## Tests

Maintain an authorization fixture with at least:
- user A tenant A;
- user B tenant A;
- user C tenant B;
- admin/support roles as applicable.
