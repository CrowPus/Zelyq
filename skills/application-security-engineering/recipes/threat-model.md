# Recipe: Threat Model

## 1. Scope
Name the feature/system and boundary.

## 2. Assets
List data, money/value, credentials, privileged actions, availability.

## 3. Actors
List:
- anonymous;
- normal user;
- privileged user;
- tenant admin;
- support/admin;
- service account;
- third-party system.

## 4. Data flows
Document:
- source;
- destination;
- authentication;
- authorization;
- protocol;
- sensitive data.

## 5. Trust boundaries
Mark every authority/data trust transition.

## 6. Abuse cases
Ask:
- spoof;
- unauthorized read/write;
- replay/duplicate;
- tamper;
- injection;
- excessive resource use;
- unsafe failure;
- third-party compromise.

## 7. Requirements
Turn threats into testable invariants.

## 8. Mitigations
Assign defense to:
- architecture;
- application;
- database;
- network;
- CI/CD;
- operations.

## 9. Validation
Define how each important requirement will be verified.

## Output
Use `templates/threat-model.md`.
