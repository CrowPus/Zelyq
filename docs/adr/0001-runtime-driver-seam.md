# 1. All execution goes through a single runtime interface

- **Status:** Accepted
- **Date:** 2026-08-22

## Context

Zelyq has to run on a laptop with no setup *and* in a shared deployment where generated code must be
isolated. The obvious approaches both fail: building for local and adding cloud later means a rewrite
of everything that touches disk, and building for cloud first means nobody can try it without
infrastructure.

The system that Zelyq was extracted from had learned this the hard way. Its agent originally ran
locally; making it a hosted product meant rerouting every filesystem and shell call through HTTP.
That worked *because* those calls happened to funnel through one module. Nothing enforced that, so
it was luck.

## Decision

Define `RuntimeDriver` in `packages/runtime` as the only path to a disk or a shell, and make the
implementation a configuration choice (`ZELYQ_RUNTIME`).

Nothing outside `packages/runtime` may import `node:fs` or `node:child_process`. Agent tools, file
APIs, previews, and snapshots all go through the interface.

## Consequences

**Good**

- Local and cloud are the same code path. A bug fixed in one is fixed in both.
- Isolation becomes a property of the deployment, not a fork.
- Tools are testable against a stub driver, with no filesystem in the test.
- Anyone can add a target — Docker, Firecracker, WASM — by implementing one interface.

**Costs**

- Every filesystem operation is async and goes through an extra layer, including in local mode where
  it is not needed.
- The interface is a compatibility surface. Adding a method means implementing it everywhere.
- Local mode's containment is enforced in our code (`resolveInside`, symlink checks) rather than by
  the OS. That is a real limitation, documented in SECURITY.md: local mode is not a sandbox.
