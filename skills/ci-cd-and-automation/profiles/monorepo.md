# Profile: Monorepo

## Goal

Keep feedback fast without accidentally skipping dependents.

## Prefer

- dependency graph / affected projects;
- shared reusable CI tasks;
- task caching;
- remote cache when trustworthy;
- test/build sharding;
- ownership boundaries.

## Avoid

Path filters alone when dependencies cross directory boundaries invisibly.

## Release

Different packages/services may have different release cadences.

Do not force one mega-release if the architecture supports independent delivery.

Conversely, if changes must be atomic across components, design an explicit coordinated release.
