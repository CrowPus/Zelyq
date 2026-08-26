# Artifacts, Provenance, and Supply Chain

## Build once

The artifact that passed release verification should be the artifact promoted to production.

Bad:

```text
commit → build staging
same commit → later rebuild production
```

The second build may differ because of:
- changed dependencies;
- changed base image;
- external downloads;
- timestamps;
- toolchain changes.

Prefer:

```text
commit
  ↓
trusted build
  ↓
artifact digest sha256:...
  ├─ staging
  └─ production
```

## Artifact identity

Record:
- source commit;
- version/build ID;
- digest;
- build workflow;
- timestamp;
- package/container registry location.

Deploy by immutable version/digest where possible, not floating `latest`.

## Provenance

SLSA provenance describes where, when, and how an artifact was produced.

For significant binaries/images/packages:
- create build provenance;
- store it alongside artifact;
- verify it where trust requirements justify it.

GitHub Artifact Attestations support provenance for binaries and container images.

## SBOM

An SBOM helps inventory shipped components.

Generate/store one when:
- customers/compliance require it;
- security response benefits;
- distributable artifacts have meaningful dependency supply-chain risk.

Do not confuse "SBOM exists" with "dependencies are safe."

## Signing and attestation

Use signature/attestation mechanisms appropriate to ecosystem.

Prefer keyless/short-lived identity when supported to reduce private signing-key management.

## Dependency review

Review new/changed dependencies before merge:
- vulnerability;
- unexpected package;
- license;
- runtime/dev scope;
- maintainer/source confidence.

GitHub's dependency review can block PRs that introduce vulnerable dependencies.

## Base images/toolchains

Pin container bases/toolchains according to project policy.

Digest pinning improves reproducibility but requires an update mechanism to receive security fixes. Automation should surface updates rather than leaving immutable pins stale forever.

## Promotion

Promotion should change **environment association**, not artifact content.

Configuration may differ by environment, but artifact identity should remain stable unless the release architecture intentionally packages config with the artifact.

## Sources

- https://slsa.dev/spec/
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
- https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review
