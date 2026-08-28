---
name: authentication-and-accounts
description: Implement login, signup, sessions, OAuth/OIDC, password recovery, account linking, roles, and protected routes. Use for identity and account lifecycle work, not generic UI gates.
---

# Authentication and Accounts

Authentication proves identity; authorization decides whether that identity may perform this action. Preserve that separation in every layer.

## Model the lifecycle

Define signup, verification, login, renewal, logout, recovery, credential change, linking, deletion, and administrative recovery as explicit transitions. Decide what invalidates existing sessions and what audit evidence remains.

## Core rules

- Prefer maintained framework/provider primitives over custom cryptography or token protocols.
- Hash passwords with an adaptive password hash; never encrypt or log them.
- Use secure, HTTP-only, same-site cookies for browser sessions unless architecture requires otherwise.
- Rotate session identifiers across authentication and privilege changes; enforce expiry and revocation server-side.
- Validate OAuth/OIDC state, PKCE, nonce where applicable, redirect URI, issuer, audience, signature, and expiry.
- Link identities only through a verified deliberate flow; matching an unverified email is insufficient.
- Authorize every protected operation against its resource and tenant.
- Rate-limit credential and recovery endpoints without creating easy account lockout.
- Avoid account-enumeration leaks.

## Recovery and verification

Recovery must not be weaker than login. Make reset tokens single-use, scoped, short-lived, and stored safely. Require recent authentication for sensitive changes.

Test invalid, expired, and replayed credentials; fixation; logout/revocation; cross-user and cross-tenant access; unverified identities; callback state mismatch; link collisions; concurrent recovery; and partial failure. Never expose tokens in output.
