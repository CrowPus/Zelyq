# Profile: Library / Package

## Priorities

- public API compatibility;
- supported runtime matrix;
- packaging correctness;
- immutable version publishing;
- changelog/release notes;
- provenance.

## CI

Test:
- minimum supported runtime where feasible;
- current stable runtime;
- platform matrix if behavior is OS-dependent;
- package install/import from the built package itself.

Do not test only the source workspace if packaging can differ.

## Publish

Use trusted protected release/tag/main flow.

Avoid registry secrets in untrusted PR jobs.
