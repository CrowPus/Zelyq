# Architecture

Zelyq is three processes over four libraries. This document explains what each one owns and, more
usefully, *why the boundaries are where they are*.

## The shape

```
Browser
  │  REST (state) + WebSocket (the conversation)
  ▼
apps/server ──HTTP/SSE──▶ apps/agent
  │                          │
  │ owns the database        │ owns the model loop
  │                          │
  └──────────┬───────────────┘
             ▼
     packages/runtime  ── the only path to disk or shell
             │
    ┌────────┴─────────┐
  local              remote
  child_process      HTTP → runtime host (container / VM)
```

## Why three processes and not one

A single process would be simpler to start and worse at everything else:

- **The agent is the part that hangs.** A model turn can run for minutes and hold a lot of memory.
  Isolating it means a wedged turn does not take the API down with it, and the agent can be
  restarted, scaled, or moved to a bigger machine independently.
- **The runtime is the part that is dangerous.** Keeping execution behind an interface, in its own
  process boundary, is what makes it swappable for a sandboxed host without touching the rest.
- **The UI is the part that changes most often.** It is a static bundle. It should not need the
  server rebuilt to ship a copy change.

## `packages/core` — the contracts

Domain types and the wire protocol, defined once as Zod schemas and imported everywhere.

The important consequence: **the browser and the agent speak the same event vocabulary.** The server
relays `AgentEvent`s rather than translating them. Adding a new event type means adding it to
`protocol.ts`; both ends then fail to compile until they handle it, which is exactly the pressure you
want.

## `packages/runtime` — the execution seam

`RuntimeDriver` is the most load-bearing interface in the project. Every file read, every file write,
every shell command, and every dev server goes through it.

Two implementations ship:

| Driver | Backed by | Isolation | Use for |
| --- | --- | --- | --- |
| `local` | `child_process` + `fs` | None — your user's permissions | Your own machine |
| `remote` | HTTP to a runtime host | Whatever the host provides | Anything shared |

Because the agent has no other way to reach a disk, moving from a laptop to a sandboxed cluster is a
configuration change, not a rewrite. That property is worth protecting: **if you find yourself
importing `node:fs` outside `packages/runtime`, that is a bug.**

The remote contract is documented in [runtime-protocol.md](./runtime-protocol.md).

## `packages/db` — persistence

Drizzle over SQLite (via libSQL) or PostgreSQL. Both schemas are maintained by hand and kept
identical by `test/schema-parity.test.ts`, which compares column names, nullability, defaults, and
primary keys and fails the build on any drift.

Repositories are written once. `client.ts` documents the single cast that makes that possible and
the rule that keeps it safe: repositories may use only portable Drizzle operations.

Two schema decisions exist purely for parity: timestamps are ISO-8601 strings, and structured values
are JSON in text columns.

## `packages/tools` — what the agent can do

Each tool is a name, a description written *for the model*, a Zod schema, and a `run` function that
receives a `ToolContext`. A tool gets no ambient access to anything — only what is on the context.

`executeTool` never throws for an expected failure. A missing file, an ambiguous edit, a failing
command: all come back as a `ToolResult` with `isError: true`, because that is information the model
should recover from rather than a reason to end the turn.

## `apps/agent` — the model loop

One `AgentSession` per project conversation. The loop is hand-written rather than using a vendor's
agent helper, for three reasons none of them cover together:

1. per-token streaming to the UI;
2. a `tool.start` event emitted *before* the tool runs, so the UI shows work in progress;
3. cancellation that takes effect mid-tool.

Tool calls within one assistant turn run concurrently and their results are returned in a single
user message — splitting them teaches the model to stop parallelising.

Turns are streamed to the server as SSE.

### Providers

Vendors differ in more than parameter names — message shapes, how reasoning is represented, how tool
calls are identified, and what must be echoed back verbatim to keep a turn coherent. Flattening that
into one neutral format loses information that the next request needs: Anthropic requires thinking
blocks returned unchanged, and Gemini requires the `thoughtSignature` on each reasoning part.

So `Conversation` (in `apps/agent/src/providers`) keeps each vendor's **native** history and exposes
only three operations: add a user message, stream one round-trip, add tool results. The session loop
reads identically whichever provider is behind it.

| Provider | Default model | Reasoning control | Tool schema |
| --- | --- | --- | --- |
| `anthropic` | `claude-opus-5` | adaptive thinking + `effort` | JSON Schema as-is |
| `google` | `gemini-3.7-flash` | `thinkingLevel` + `includeThoughts` | JSON Schema via `parametersJsonSchema`, scrubbed of `$schema`/`$ref` |

Adding a provider is an entry in `PROVIDERS` plus a `ModelProvider` implementation. Nothing outside
that directory knows which vendor is in use.

## `apps/server` — state and fan-out

Owns the database, the file and preview APIs, and the browser WebSocket. `ChatGateway` maps one
project to one room, so two open tabs watch the same turn.

The gateway persists the user message *before* the turn starts, so a crash still leaves a readable
transcript, and folds the agent's event stream into the assistant row as it goes.

## `apps/web` — the client

React 19, Vite, Tailwind v4, TanStack Query for REST state, and a single hook for the WebSocket.

`useChatSocket`'s reducer is deliberately the mirror image of the gateway's persistence logic: both
consume the same events, one into a database row and one into React state. Keeping them symmetrical
is why a page refresh shows what was on screen before it.

## Request paths

**Creating a project**

```
POST /api/projects
  → ProjectService.create
      → store.projects.create        (status: creating)
      → runtime.ensureProject        (mkdir)
      → loadTemplate + runtime.scaffold
      → store.projects.setStatus     (status: ready)
```

If scaffolding fails, the project is marked `error` with the reason rather than left silently empty.

**A prompt**

```
browser ──ws {type:"prompt"}──▶ ChatGateway
   ├─ persist user message
   ├─ agent.createSession (with history)
   └─ for await (event of agent.prompt(...))
        ├─ broadcast to every socket in the room
        └─ fold into the assistant message
              ↑
        agent: stream → tools → stream → … → turn.end
```

## Access control

Authentication and authorization are separate steps in separate places.

*Authentication* happens once per request, in a single `onRequest` hook that turns a session cookie
into a user. It answers only "who is this"; it never decides anything.

*Authorization* lives entirely in `AccessControl` (`apps/server/src/services/access.ts`). Routes call
`requireProject(user, id, "editor")`, which loads the project and checks the caller's role in its
team in one step — so a route cannot load a project without also checking access to it, which is the
usual way an endpoint ends up unguarded.

There is no per-project permission table. A project belongs to a team, a role in that team is the
whole answer, and roles are ranked so every check reads "at least this role". Two places to look is
how a resource ends up reachable through the one nobody remembered to check.

The browser has its own gate, but it is cosmetic: it decides which screen to render. Every decision
that matters is made again on the server.

## What is deliberately not here yet

Quotas, SSO, and git integration are all absent. Each of them is easier to
add against settled interfaces than to retrofit into a system that guessed at them early. See
[roadmap.md](./roadmap.md).

An audit log exists, scoped to project- and team-level actions — `access.recordChange` is called
after each one succeeds, and `GET /api/teams/:id/audit-log` (admin role or higher) reads it back.
Instance-wide actions (settings, account deletion) and per-prompt attribution are not in it yet —
both would need their own read surface or schema change, named as deliberate follow-ups rather than
silently expanded into.
