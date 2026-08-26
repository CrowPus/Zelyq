# Attack Surface Mapping

## Goal

Understand where untrusted influence enters and where authority/data exits.

## Code surface

Map:
- routes;
- RPC handlers;
- GraphQL resolvers;
- webhooks;
- background consumers;
- scheduled jobs;
- file processors;
- template/render functions;
- database query builders;
- command/process calls;
- HTTP clients;
- deserializers;
- admin interfaces;
- feature-flagged paths.

## Identity surface

Map:
- login;
- signup;
- password reset;
- MFA;
- SSO/OIDC;
- invite acceptance;
- API keys;
- service accounts;
- impersonation;
- support/admin tools;
- session refresh/logout.

## Data surface

Map:
- PII;
- secrets;
- uploads;
- exports;
- logs;
- backups;
- caches;
- analytics;
- third-party transfer.

## Runtime surface

For authorized deployed systems, inventory known:
- hosts;
- documented routes;
- API versions;
- environments;
- role-specific pages;
- public files;
- client bundles.

Avoid uncontrolled enumeration outside scope.

## Prioritization

High-value review areas often include:
- object IDs in multi-tenant systems;
- admin/role transitions;
- upload/import;
- URL/webhook fetch;
- payments/credits;
- batch actions;
- exports;
- recovery/auth changes;
- background jobs that trust messages;
- legacy/deprecated API versions.

## Output

Create a bounded inventory linked to:
- owner;
- trust boundary;
- auth requirement;
- sensitive data;
- relevant tests.
