# Profile: Authentication and Identity

## Map every identity path

- registration;
- login;
- passwordless;
- SSO/OIDC/SAML if used;
- MFA;
- password reset;
- email/phone change;
- recovery codes;
- API keys;
- session refresh;
- logout;
- account deletion;
- support/admin recovery;
- impersonation.

A weaker alternate pathway can undermine a strong main login.

## Sensitive changes

Consider reauthentication or higher assurance for:
- password/MFA changes;
- payment destination;
- email/phone identity;
- API key creation;
- privileged role grants.

## Enumeration

Review whether:
- signup;
- login;
- password reset;
- invite

reveal account existence in a way that materially increases risk.

## Token lifecycle

For every token define:
- purpose;
- audience;
- expiry;
- single/multiple use;
- revocation;
- storage;
- transport.
