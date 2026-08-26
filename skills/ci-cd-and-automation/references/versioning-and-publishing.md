# Versioning and Publishing

## Libraries/packages differ from services

A library release cannot be "rolled back" from consumers once downloaded in the same way a service deployment can.

Prioritize:
- compatibility;
- versioning;
- immutable package versions;
- provenance;
- changelog/release notes;
- consumer testing.

## Version identity

Never overwrite an existing published immutable version when the ecosystem assumes immutability.

Use project ecosystem's versioning policy (often semantic versioning, but not universally).

## Publish from trusted source

Prefer:
- protected tag/release or trusted main;
- clean build;
- verified tests;
- short-lived registry identity/token where supported;
- provenance/attestation.

## Consumer compatibility

Test representative:
- supported runtimes;
- OS/architectures;
- framework versions;
- public API compatibility.

## Pre-release

Use alpha/beta/rc channels for early validation when ecosystem supports them.

Do not silently publish unstable behavior as a stable version.

## Deprecation

Breaking changes require:
- migration guidance;
- deprecation period where appropriate;
- clear release notes.

## Package contents

Inspect the actual packaged artifact, not only source tree.

Verify:
- intended files;
- licenses;
- source maps/types;
- no secrets;
- correct entry points.
