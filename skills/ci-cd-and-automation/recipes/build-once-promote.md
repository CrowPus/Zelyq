# Recipe: Build Once, Promote by Digest

## Build job

1. checkout trusted source;
2. install from lockfile;
3. run required build-time checks;
4. produce artifact;
5. compute/store digest;
6. publish to registry/store;
7. create attestation/SBOM when required.

## Deploy jobs

Consume:
- artifact version;
- immutable digest.

Do not run source compilation again in production deploy.

## Verification

Record:
- commit;
- artifact digest;
- deployment environment.

If production digest differs from verified staging digest without an intentional new release, fail.
