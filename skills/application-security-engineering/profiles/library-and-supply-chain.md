# Profile: Library / Supply Chain

## Public API security

Review:
- unsafe defaults;
- command/file/network capabilities;
- deserialization;
- cryptography;
- path handling;
- URL handling;
- parsing limits.

A library can transfer security risk to every consumer.

## Dependencies

Minimize dependency count and privilege.

Review new packages for:
- maintenance;
- provenance/source;
- install scripts;
- transitive risk;
- license/policy.

## Release integrity

Coordinate with CI/CD skill:
- trusted publishing;
- immutable versions;
- provenance/attestation;
- secrets;
- package contents.

## Vulnerability disclosure

If a released library vulnerability is confirmed, remediation may need:
- patched version;
- advisory;
- migration guidance;
- coordinated disclosure.
