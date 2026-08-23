# Runtime host protocol

`ZELYQ_RUNTIME=remote` makes the agent and server call an HTTP host instead of running things
locally. The contract is small on purpose: anything that can serve these routes is a valid Zelyq
runtime — a container per project, a microVM, a Kubernetes pod, or a box under your desk.

All requests carry `Authorization: Bearer $ZELYQ_RUNTIME_TOKEN` when a token is configured. Bodies
and responses are JSON.

## Routes

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/v1/health` | — | `{ version?: string }` |
| `POST` | `/v1/projects/:id` | — | `{ projectId, root }` — idempotent |
| `DELETE` | `/v1/projects/:id` | — | `204` — idempotent |
| `POST` | `/v1/projects/:id/scaffold` | `{ files: ScaffoldFile[] }` | `204` |
| `POST` | `/v1/projects/:id/exec` | `{ command, cwd?, timeoutMs?, env?, maxOutputBytes? }` | `ExecResult` |
| `GET` | `/v1/projects/:id/files?path=&depth=&includeIgnored=` | — | `{ entries: FileEntry[] }` |
| `GET` | `/v1/projects/:id/files/*` | — | `FileContent` |
| `PUT` | `/v1/projects/:id/files/*` | `{ content, encoding }` | `204` |
| `DELETE` | `/v1/projects/:id/files/*` | — | `204` |
| `POST` | `/v1/projects/:id/preview/start` | `{ command?, port?, env? }` | `Preview` |
| `POST` | `/v1/projects/:id/preview/stop` | — | `Preview` |
| `GET` | `/v1/projects/:id/preview` | — | `Preview` |
| `GET` | `/v1/projects/:id/preview/logs?lines=` | — | `{ logs: string }` |
| `POST` | `/v1/projects/:id/snapshots` | `{ label }` | `Snapshot` |
| `POST` | `/v1/projects/:id/snapshots/:snapshotId/restore` | — | `204` |
| `GET` | `/v1/projects/:id/snapshots/:snapshotId/files/*` | — | `FileContent` |

Payload types are the exported TypeScript types in `@zelyq/core` and `@zelyq/runtime`.

## Requirements on an implementation

These are what `LocalRuntimeDriver` guarantees, and what callers assume:

1. **Containment.** Every path is relative to the project root. A path that escapes it — through
   `..`, an absolute path, or a symlink — must be **rejected**, not clamped. Returning `400` is
   correct; silently writing elsewhere is a vulnerability.
2. **Termination.** `exec` always returns within `timeoutMs`. Kill the whole process group, not just
   the direct child, or dev servers will leak and hold ports.
3. **Truncation, not failure.** Output beyond `maxOutputBytes` is cut with `truncated: true`.
4. **Idempotence.** Creating an existing project or deleting a missing one both succeed.
5. **Unknown project → `404`,** which the driver surfaces as a `not_found` error.

## Isolation guidance

The runtime host is the security boundary, so it is where the limits belong:

- one container or VM per project, with no shared filesystem;
- CPU, memory, disk, and process-count limits;
- egress restricted to what package installs need;
- unprivileged user, read-only base image, writable project directory only;
- previews exposed through the host, never by publishing container ports directly.

## Status

The interface and both drivers ship today. A reference runtime host implementation is on the
[roadmap](./roadmap.md) — until then, `remote` expects a host you provide.
