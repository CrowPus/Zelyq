# API Security

## Use the API risk model

OWASP API Security Top 10:2023 emphasizes:
- object-level authorization;
- authentication;
- object-property authorization;
- resource consumption;
- function-level authorization;
- sensitive business flows;
- SSRF;
- misconfiguration;
- inventory;
- unsafe consumption of APIs.

## Object authorization

Every endpoint that accepts an object identifier should enforce authorization based on the current principal and resource.

Do not infer access from:
- object existence;
- URL secrecy;
- UUID unpredictability.

## Property authorization

Review create/update/serialization separately.

Risks:
- mass assignment;
- hidden admin fields;
- over-broad DTO binding;
- returning internal/sensitive fields.

Explicitly define writable/readable properties by role/context.

## Function authorization

Administrative and privileged functions require explicit policy.

Changing HTTP method/path should not bypass checks.

## Resource consumption

Bound:
- pagination;
- batch size;
- nested GraphQL/query complexity where applicable;
- file size;
- expensive search;
- email/SMS actions;
- third-party billable calls;
- CPU-heavy transforms.

## Sensitive business flows

Rate limiting alone may not solve:
- ticket scalping;
- account farming;
- coupon abuse;
- inventory reservation abuse.

Model the business harm and appropriate anti-automation/eligibility controls.

## Inventory

Track:
- API versions;
- environments;
- deprecated endpoints;
- debug/admin interfaces;
- docs/contracts.

Old APIs are security liabilities if controls drift.

## Third-party APIs

Treat provider responses as untrusted input.

Validate:
- schema;
- signature where appropriate;
- identifiers;
- redirect/callback data;
- bounds.

Do not assume "trusted vendor" means safe data.
