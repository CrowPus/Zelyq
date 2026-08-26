# Deployment, Release, and Rollback

## Principle

A change is not production-ready until there is a safe way to introduce it, detect harm, and recover.

## Pre-release questions

- What changed externally?
- Is the change backward compatible?
- Does it touch schema/data?
- Do old/new app versions coexist during rollout?
- Are jobs/events in flight?
- Which metric shows success/failure?
- Can the behavior be disabled?
- What is rollback/fix-forward?

## Separate deployment from release where useful

A feature flag can decouple code deployment from user exposure.

Use flags when they materially reduce risk. Do not create permanent flag debt.

Define:
- owner;
- default;
- rollout plan;
- removal condition/date;
- behavior in both states.

## Staged rollout

For risky changes consider:
- internal users;
- small percentage/canary;
- selected tenants;
- region;
- progressive percentage.

Promotion needs observable acceptance criteria.

## Backward compatibility during rollout

During rolling deploys assume old and new versions may run simultaneously.

Be careful with:
- database columns/types;
- events;
- caches;
- session/token formats;
- config;
- RPC/API schemas.

Use expand/migrate/contract for incompatible schema evolution.

## Rollback

A rollback plan states:
- command/process;
- expected duration;
- compatible artifact/version;
- data implications;
- feature-flag fallback;
- who/what decides to roll back.

Do not write "rollback deployment" when a data migration made the old version incompatible.

## Fix-forward

Sometimes rollback is more dangerous than fixing forward, especially after irreversible external/data side effects.

Decide before release where possible.

## Database migration rollout

Run risky migrations separately from application startup when appropriate.

Large migrations/backfills need progress telemetry and recovery.

## Release verification

After deployment verify:
- health/readiness;
- error rate;
- critical flow success;
- latency;
- queue/backlog;
- domain metrics;
- migration progress.

## DORA perspective

Current DORA software-delivery performance uses throughput and instability measures including change lead time, deployment frequency, failed deployment recovery time, change failure rate, and deployment rework rate.

Fast delivery and safe delivery are not opposites; small reversible changes help both.

## Post-release

Remove:
- temporary compatibility code;
- completed flags;
- obsolete schema;
- temporary alerts/logging only after confidence is established.

Update release notes/runbooks when behavior changes.

## Source

- DORA metrics history: https://dora.dev/insights/dora-metrics-history/
