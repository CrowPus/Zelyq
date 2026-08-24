# Agent behaviour

How the agent decides what to do, and how to change it.

## The turn

```
prompt
  └─▶ stream a model response
        ├─ text / thinking deltas → the UI, live
        └─ tool_use blocks?
              ├─ yes → run them concurrently, return every result in one user
              │        message, loop
              └─ no  → files changed since the last check?
                          ├─ yes → run it (see below); found a problem?
                          │           ├─ yes → hand it back, loop
                          │           └─ no  → turn ends
                          └─ no  → turn ends
```

Bounded by `ZELYQ_MAX_TURN_ITERATIONS` (default 50). Hitting the cap ends the turn cleanly rather
than looping forever — a verification round-trip counts against this cap the same as any other tool
call.

## Automatic verification

The system prompt asks the model to verify its own work; nothing forced that until `session.ts`
gained a gate at the one point that matters — the moment the model stops asking for tools. When files
changed since the last check, `AgentSession` runs the project's own `typecheck` script (falling back
to `build`, which the scaffolded template also typechecks through) and, if the preview crashed, reads
its log — the same convention `detectDevCommand` uses for reading a project's actual `package.json`
rather than assuming a command exists. A project with neither script, or that never changed a file,
gets no automatic step at all: it shows up in the transcript as a `verify` tool call only when there
was something to check.

**This is not proof the app renders correctly.** `previewStatus === "running"` is treated as passing,
honestly: Vite recovers from many build errors without exiting, so this catches a dead process and a
type error, not every possible broken render. A full headless-browser check exists in the eval
harness (`apps/agent/evals`) for measuring that; bringing an equivalent check into every live turn is
a larger, slower project, not something this gate does.

A failure is handed back as a user-turn message rather than a tool result, because there is no
`tool_use` id to attach one to — the model's last message had none, which is exactly why the gate
fired.

## The three inputs that shape behaviour

**1. The system prompt** (`apps/agent/src/prompt.ts`) is the biggest lever. It sets: look before you
touch, prefer `edit_file` over `write_file`, verify by running the typecheck and the preview, read
`preview_logs` before guessing, and report what changed rather than narrating.

Change it deliberately. Small wording changes move behaviour more than they look like they should —
try a change against several real prompts before keeping it.

**2. The tool descriptions** (`packages/tools`) are prompt text too. `search_files` says it is
"much cheaper than reading files to find something" because otherwise the model reads files it does
not need. When a tool is misused, the description is usually the fix.

**3. Effort** (`ZELYQ_EFFORT`) controls reasoning depth. `high` is the default; `xhigh` is worth it
for complex multi-file work; `low` is for small, well-specified edits. On Claude this maps to
adaptive thinking at that effort; on Gemini to a thinking level, where `xhigh` and `max` both land on
`high` because Gemini has nothing above it.

The same system prompt and tools are used for every provider. If a model behaves noticeably worse,
prefer fixing the prompt or a tool description over branching on the provider — a per-vendor prompt
fork doubles the surface that has to be tuned and tested.

## Why tool errors are not exceptions

Every failure inside `executeTool` comes back as `{ isError: true, output }`. A file that does not
exist, an ambiguous edit, a command that exits non-zero — the model reads the message and adapts.
Throwing would end the turn and lose the recovery the model is good at.

The corollary: **error messages are prompts.** Compare

> `No match in src/App.tsx. The text to replace was not found exactly — check whitespace and
> indentation, and read the file again if needed.`

with `Error: no match`. The first tells the model what to do next.

## Guardrails

- `run_command` refuses commands that never return (`npm run dev`, `tail -f`, watchers) and points
  at `start_preview` instead. Without this the turn hangs until the timeout.
- `edit_file` refuses ambiguous matches rather than replacing the first one.
- Every path is confined to the project root by the runtime, not by the tool.
- Tool output is truncated head-and-tail with a note, so one large file cannot eat the context.

## Caching

The system prompt carries a cache breakpoint. Prompt and tool list are stable across a session, so
after the first request each turn re-reads them from cache. If you make the system prompt dynamic —
injecting a timestamp, say — you invalidate that on every request and pay full price for it. Check
`usage.cache_read_input_tokens` if costs look wrong.

## Adding a tool

1. Define it in `packages/tools/src/` with `defineTool` — Zod schema, description written for the
   model.
2. Add it to `ALL_TOOLS` in `packages/tools/src/index.ts`. Navigation tools before mutating ones.
3. Add a test. `test/tools.test.ts` already checks that every tool has a valid definition and a real
   description.

The tool receives a `ToolContext` and nothing else. If it needs something not on that context, add
it there rather than importing a global — that constraint is what keeps tools testable and the
runtime swappable.
