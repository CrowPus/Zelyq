# Profile: Container / Image

## Build

- use reproducible/pinned base inputs according to policy;
- minimize unnecessary build context;
- avoid secrets baked into layers;
- use BuildKit secrets/mounts where needed rather than ARG/ENV for sensitive build credentials;
- tag human-readable version and retain immutable digest.

## Verify

- test built image, not only source;
- scan image/dependencies where policy requires;
- generate provenance/attestation;
- SBOM when useful/required.

## Deploy

Promote by digest.

Do not deploy `latest` as the only production identity.

## Multi-architecture

If publishing multiple architectures, verify each supported target or ensure the build system reproducibly builds the manifest list.
