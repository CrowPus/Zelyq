# Profile: High-Risk Internet-Facing Application

Examples:
- financial;
- healthcare;
- identity;
- admin/control plane;
- large multi-tenant SaaS;
- systems with sensitive regulated data.

## Expect higher assurance

Consider:
- more complete ASVS profile;
- formal threat model;
- independent review;
- SAST/SCA/secrets;
- security integration tests;
- authorized dynamic assessment;
- supply-chain provenance;
- stronger security logging/alerting;
- abuse/resource controls;
- incident response/recovery.

## Privileged surfaces

Review:
- admin APIs;
- support tools;
- impersonation;
- exports;
- bulk actions;
- role grants;
- key management;
- recovery.

## Residual risk

Document what was not validated.

Do not translate "high risk" into destructive testing. Increase verification quality, not blast radius.
