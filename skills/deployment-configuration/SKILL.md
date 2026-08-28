---
name: deployment-configuration
description: Prepare applications for hosting by defining environment configuration, build/start commands, runtime assumptions, health checks, and safe deployment behavior. Use for deployment setup or “works locally but not hosted” problems.
---

# Deployment Configuration

Make the runtime contract explicit and portable. Never invent credentials or claim success without observing the target.

## Discover the target

Inspect framework output, package scripts, lockfiles, runtime version, binding, services, filesystem writes, jobs, migrations, and existing platform config. Determine whether the target expects static assets, a server, serverless handlers, containers, or separate processes.

## Configuration rules

- Separate build-time public variables from runtime secrets.
- Fail startup clearly for required missing or malformed configuration.
- Keep secrets out of client prefixes, bundles, logs, and health responses.
- Bind to platform-provided host/port.
- Do not rely on persistent local disk unless guaranteed.
- Use the repository package manager and lockfile; declare runtime versions.
- Keep development conveniences out of production start.

## Release behavior

Define build, migration, start, health/readiness, shutdown, and rollback. Handle termination signals and drain work where applicable. Run migrations compatibly with old and new versions; do not make replicas race through unsafe schema work.

For SPAs, configure history fallback without serving HTML for missing JS/CSS. Trust forwarded protocol/host only behind configured proxies.

## Verification

Build from a clean checkout, start the production artifact with documented config, exercise health and a critical path, and test missing-config failure. Inspect the client artifact for leaked secrets. If target access exists, verify logs, routing, TLS, persistence, and rollback; otherwise state the exact unverified operator steps.
