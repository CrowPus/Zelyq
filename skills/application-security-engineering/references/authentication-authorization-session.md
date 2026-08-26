# Authentication, Authorization, and Session Security

## Separate concepts

Authentication: who/what is the principal?

Authorization: may this principal perform this action on this resource?

Session/token management: how is authenticated state maintained and terminated?

Do not merge them conceptually.

## Authentication review

Check:
- all authentication pathways;
- password policy/storage;
- MFA/recovery;
- enumeration;
- brute-force/credential-stuffing defenses;
- reauthentication for sensitive changes;
- account lifecycle;
- alternative/weaker channels.

OWASP ASVS 5.0 explicitly requires documenting multiple authentication pathways and security controls.

## Password storage

Use established password hashing libraries.

OWASP currently recommends Argon2id as the preferred option where available; use ecosystem/compliance-appropriate alternatives when necessary.

Never:
- plaintext;
- reversible encryption merely for login verification;
- fast general-purpose hashes like SHA-256 alone.

## Password reset

Tokens/codes should be:
- unpredictable;
- time-limited;
- single-use;
- securely stored;
- bound to intended account/action.

Avoid account enumeration through message or materially different behavior.

## Authorization

Enforce server-side for every protected:
- object;
- function;
- field/property;
- tenant;
- administrative action.

Do not trust:
- hidden UI;
- disabled button;
- client role claim without server verification;
- object ID ownership implied by route.

### Authorization matrix

Test representative combinations:

```text
role × action × resource ownership × tenant
```

Include:
- self;
- same tenant other user;
- other tenant;
- admin;
- disabled/deleted user where relevant.

## Sessions

Review:
- secure cookie/token storage;
- rotation when privilege/auth state changes;
- expiration;
- refresh;
- logout/invalidation;
- concurrent sessions;
- CSRF where cookie-based auth is used;
- revocation model where required.

## Self-contained tokens

Verify according to system design:
- signature;
- allowed algorithms;
- issuer;
- audience;
- expiry/not-before;
- key lifecycle;
- privilege claims;
- revocation/rotation strategy.

Do not accept tokens merely because the signature library returns true.
