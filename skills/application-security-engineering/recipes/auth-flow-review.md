# Recipe: Authentication Flow Review

## Inventory all paths

Map:
- login;
- SSO;
- reset;
- MFA;
- magic link;
- account recovery;
- email/phone change;
- session refresh;
- support recovery.

## For each path define

- proof of identity;
- token/credential;
- lifetime;
- replay policy;
- brute-force/abuse control;
- account-enumeration behavior;
- session effect;
- audit event.

## Compare strength

The weakest route can define effective account security.

Example:
Strong MFA login + weak email-change/support recovery can still enable takeover.

## Validate safely

Use test accounts.

Test:
- expired token;
- reused token;
- wrong user;
- changed password/session;
- repeated attempts;
- privilege-sensitive changes.

Do not attempt credential attacks against real users.
