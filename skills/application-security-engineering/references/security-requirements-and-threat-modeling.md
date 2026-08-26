# Security Requirements and Threat Modeling

## Start with security properties

Before vulnerability categories, identify:
- confidentiality;
- integrity;
- availability;
- authentication;
- authorization;
- accountability;
- tenant isolation;
- privacy;
- non-duplication/idempotency;
- financial/value invariants.

## Asset inventory

Examples:
- credentials;
- sessions/tokens;
- personal data;
- payment state;
- API keys;
- administrative actions;
- tenant data;
- intellectual property;
- files;
- audit records.

## Trust boundaries

Mark transitions between:
- browser and server;
- public API and internal service;
- service and database;
- service and queue;
- service and third-party API;
- tenant A and tenant B;
- normal and admin privileges;
- build pipeline and production;
- untrusted file and parser.

## Abuse-oriented questions

For each flow ask:
- Can identity be spoofed?
- Can access scope be expanded?
- Can data be modified before validation?
- Can a request be replayed?
- Can an operation be duplicated?
- Can ordering be changed?
- Can resources be exhausted?
- Can a timeout/exception cause fail-open behavior?
- Can a lower-trust system influence a higher-trust decision?

## Security decision record

Document important decisions such as:
- role/permission model;
- tenant boundary;
- accepted redirect/outbound domains;
- file types;
- authentication strength;
- sensitive-data classifications;
- rate/abuse controls;
- cryptographic choices.

ASVS 5.0 explicitly emphasizes documented security decisions so implementation can be verified against intended controls.

## Prioritization

Focus first on threats that affect:
- privileged access;
- cross-tenant data;
- authentication;
- financial/value state;
- code execution/interpreter boundaries;
- sensitive exports;
- secrets;
- broad availability.

## Output

A useful threat model produces:
- assets;
- actors/roles;
- trust boundaries;
- key flows;
- abuse cases;
- security requirements;
- mitigations;
- validation plan.

It should guide engineering and tests, not become a diagram nobody uses.
