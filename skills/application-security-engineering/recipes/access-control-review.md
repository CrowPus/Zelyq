# Recipe: Access Control Review

## Build a matrix

Rows:
- anonymous;
- role A;
- role B;
- admin;
- disabled user if relevant.

Columns:
- create;
- read;
- update;
- delete;
- special functions;
- sensitive fields.

Add resource relationship:
- own;
- same tenant other's;
- other tenant;
- global/admin-owned.

## Trace enforcement

For every protected handler:
1. identify authenticated principal;
2. identify requested resource/action;
3. identify policy decision;
4. ensure decision occurs server-side before sensitive data/side effect;
5. ensure downstream code cannot bypass it.

## Look for gaps

- list/search endpoints;
- bulk actions;
- nested objects;
- downloads;
- exports;
- alternative HTTP methods;
- background jobs;
- admin endpoints;
- GraphQL fields/resolvers;
- property-level writes.

## Validate

Use controlled fixtures for allow and deny cases.

A 404 can be an intentional privacy-preserving deny response; verify behavior, not status-code ideology.
