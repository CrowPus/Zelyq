# 2. One language, one repository

- **Status:** Accepted
- **Date:** 2026-08-22

## Context

The system this was extracted from ran four tiers across two languages: a Python API, a Python
sandbox daemon, a TypeScript agent, and a React frontend. Every change to the agent's capabilities
touched Python schemas, Python services, TypeScript tools, and TypeScript UI — four edits, two
languages, two type systems that could not check each other.

## Decision

TypeScript everywhere, in one pnpm workspace. The wire protocol lives in `@zelyq/core` as Zod
schemas that every process imports.

## Consequences

**Good**

- One toolchain: one install, one test command, one lint config.
- The protocol is type-checked end to end. Adding an event type breaks compilation on both sides
  until it is handled.
- The agent already ran on Node, so the model loop needed no port.
- Contributors need one language to work anywhere in the codebase.

**Costs**

- Python's data and ML ecosystem is out of reach in-process. If that is ever needed, it will be a
  service behind an interface, not a tier.
- A monorepo needs discipline about package boundaries; without it, packages quietly grow circular
  dependencies.
- Node is the wrong tool for CPU-bound work. Nothing here is CPU-bound today.
