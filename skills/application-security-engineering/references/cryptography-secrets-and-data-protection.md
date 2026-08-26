# Cryptography, Secrets, and Data Protection

## Principle

Minimize sensitive data first. Encrypt what must remain sensitive.

Do not invent cryptographic primitives or protocols.

## Passwords

Use a dedicated password hashing function/library.

OWASP currently prefers Argon2id where available, with alternatives based on environment/compliance.

Do not log or reversibly encrypt passwords for normal authentication.

## Encryption

Use established authenticated encryption modes/libraries.

Define:
- threat being mitigated;
- data classification;
- key owner;
- rotation;
- backup/recovery;
- deletion.

Encryption without key management is incomplete.

## Randomness

Use cryptographically secure random generators for:
- reset tokens;
- session secrets;
- API keys;
- nonces where security-sensitive.

## Secrets

Secrets should not live in:
- source;
- client bundles;
- logs;
- public CI artifacts;
- container image layers.

Use appropriate secret management.

## Rotation

Design identifiers/formats to allow:
- multiple active keys during transition;
- key ID/version;
- staged rotation.

## Sensitive data

Review:
- collection necessity;
- storage duration;
- access;
- export;
- logs;
- analytics;
- backups;
- third-party transfer.

## Client storage

Do not store long-lived high-value secrets in browser/mobile storage without understanding theft model.

Server authority remains authoritative.
