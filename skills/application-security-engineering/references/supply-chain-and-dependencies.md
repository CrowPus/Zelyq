# Supply Chain and Dependencies

## Threat model

Risk can enter through:
- direct dependencies;
- transitive dependencies;
- package scripts;
- registries;
- build tools;
- container bases;
- CI actions;
- generated artifacts;
- compromised maintainer accounts.

OWASP Top 10:2025 elevates Software Supply Chain Failures to A03.

## Dependency review

For new dependencies ask:
- Is this necessary?
- Is it maintained?
- Is source/ownership credible?
- What privilege does it gain?
- Does it run install/build scripts?
- Is there a smaller platform/library primitive already present?

## Scanning

SCA/vulnerability scanning is useful but incomplete.

A result needs:
- affected installed version;
- reachable/used component when relevant;
- environment;
- fix availability;
- exploit/impact context.

## Locking

Use lockfiles and reproducible dependency resolution according to ecosystem.

Do not manually edit generated lockfiles unless ecosystem requires it.

## Build/release

Connect to CI/CD security:
- least privilege;
- immutable artifacts;
- provenance/attestations;
- secret scanning;
- pinned trusted build inputs.

## Typosquatting/confusion

Be careful when adding obscure packages with names similar to popular/internal packages.

Verify package origin explicitly.

## Vendored/generated code

Generated code is still shipped code.

Review the generator/source and scan the output when risk warrants it.
