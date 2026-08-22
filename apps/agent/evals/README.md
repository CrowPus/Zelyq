# Evals

A measurement, not a test suite.

`docs/agent-behaviour.md` says the system prompt is the biggest lever on the agent's behaviour, and
that small wording changes move it more than they look like they should. That is true, and it is
only useful advice if you can tell whether a change helped. This is how you tell.

```bash
pnpm eval --limit 3          # start here — it calls the real model and costs real money
pnpm eval --tag bugfix
pnpm eval --only tiny-edit,fix-import
pnpm eval                    # the whole suite
```

Each case gets a fresh project from `templates/vite-react`, one prompt, and then a set of
assertions about what the agent left behind. Nothing is judged by a human, which is the point: two
runs of the same suite are comparable.

## Reading the output

```
 ✓ tiny-edit               3 rounds    4 tools    22s
 ~ dark-mode               7 rounds   19 tools    94s  — remembers the choice
 ✗ add-routing            12 rounds   31 tools   180s  — build passes
```

- **✓ clean** — every check passed.
- **~ works** — the app builds and runs, but something softer failed. Worth reading.
- **✗ broken** — a critical check failed. The user would have received a broken app.

`works` is the headline number, and it is the one the roadmap tracks. `rounds` is how many
round-trips the model took; a case that jumps from 4 rounds to 14 is flailing even if it still
passes, and that shows up here before it shows up in your bill.

## Comparing two runs

Every run writes `evals/results/<timestamp>.json`. That is the whole reason this exists:

```bash
pnpm eval                                       # before your prompt change
# edit apps/agent/src/prompt.ts
pnpm eval --compare evals/results/<before>.json
```

```
 vs 2026-08-22T…json (prompt a1b2c3 → d4e5f6)
   works    14/18 → 16/18
   fixed    dark-mode, add-routing
   broke    none
```

Now the change can be defended with a number instead of an impression.

## The checks

Critical — these decide `works`:

| Check | What it does |
| --- | --- |
| `typecheck` | `npm run typecheck` exits 0 |
| `build` | `npm run build` exits 0 |
| `preview` | the dev server starts, serves the page, and Vite transforms **every** module under `src/` |

The last one is subtler than it looks. Vite compiles on demand, so fetching only the entry module
reports a green preview for an app whose components do not compile. Every source module is
requested for that reason.

Everything else — `file_matches`, `project_matches`, `unchanged`, `max_files_changed`,
`no_new_dependency`, `no_writes` — is a softer assertion about *how* the work was done. They are
what catch an agent that produces a working app by rewriting six files to change a label.

## Adding a case

Append to `cases.ts`. Write the prompt the way a user would actually type it — terse and slightly
under-specified. A prompt engineered to be easy measures nothing.

```ts
{
  id: "sticky-header",
  title: "Header that sticks on scroll",
  tags: ["modify"],
  setup: [{ path: "src/App.tsx", content: "…" }],   // optional: plant a bug or a starting point
  prompt: "Make the header stay put when I scroll.",
  checks: [
    { kind: "typecheck" },
    { kind: "build" },
    { kind: "preview" },
    { kind: "project_matches", pattern: "sticky|fixed", why: "the header is pinned" },
  ],
}
```

Every check must be decidable by a machine. If a human has to judge it, it does not belong here.

## Cost and time

Each case is a real model turn: expect a few cents to a few dimes, and one to three minutes. The
whole suite at `--concurrency 3` is roughly fifteen minutes.

Dependencies are installed **once** into a base project and hardlinked into each case (`cp -al`),
so a case costs about a second of setup instead of a minute. The base survives between runs; delete
`evals/workspace/` to rebuild it.

## What this does not measure

Worth stating plainly, so nobody reads a green suite as more than it is:

- **Whether it looks good.** `project_matches` can confirm a `<footer>` exists. It cannot tell you
  the page is well designed, and the system prompt asks for exactly that.
- **Runtime errors after mount.** The preview check proves every module compiles and the page is
  served. A component that throws on render still passes. Catching that needs a headless browser —
  a reasonable next step for this harness.
- **Regressions from one run.** Models are not deterministic. A single case flipping is noise; the
  suite-level `works` number moving is signal. Run it twice before believing a small change.
- **Anything but `vite-react`.** One template today. `--template` is already plumbed through for
  when there are more.
