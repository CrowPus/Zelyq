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
 ◑ dark-mode               7 rounds   19 tools    94s  — remembers the choice
 ~ landing-page            2 rounds    1 tools    18s  — uses the given name, changed something
 ✗ add-routing            12 rounds   31 tools   180s  — build passes
```

- **✓ clean** — every check passed, cosmetic ones included.
- **◑ done** — the work was done; only a cosmetic check failed.
- **~ intact** — it still builds and runs, but the work was **not** done.
- **✗ broken** — a critical check failed. The user would have received a broken app.

`done` is the headline number and the one the roadmap tracks: the project is intact *and* every
check that is not marked `cosmetic` passed. `rounds` is how many round-trips the model took; a case
that jumps from 4 rounds to 14 is flailing even if it still passes, and that shows up here before it
shows up in your bill.

### Why `intact` is not the headline

It used to be, under the name `works`, and it was wrong. `intact` means typecheck, build and preview
all passed — and **every case starts from a template that already satisfies all three**. An agent
that changes nothing scores 100%.

That is not a hypothetical: it scored 100% in every run ever recorded, while the underlying check
counts moved between 92 and 113. A stand-in model written to exercise plumbing did nothing at all
and scored full marks. See `017` in the council notes.

`intact` is still reported, because an agent that leaves a broken build has to be visible
immediately. It just does not answer "did it do the job".

## Comparing two runs

Every run writes `evals/results/<timestamp>.json`. That is the whole reason this exists:

```bash
pnpm eval                                       # before your prompt change
# edit apps/agent/src/prompt.ts
pnpm eval --compare evals/results/<before>.json
```

```
 vs 2026-08-22T…json (prompt a1b2c3 → d4e5f6)
   done     14/18 → 16/18
   fixed    dark-mode, add-routing
   broke    none
```

Now the change can be defended with a number instead of an impression.

## The checks

Critical — these decide `intact`, and nothing else:

| Check | What it does |
| --- | --- |
| `typecheck` | `npm run typecheck` exits 0 |
| `build` | `npm run build` exits 0 |
| `preview` | the dev server starts, serves the page, and Vite transforms **every** module under `src/` |

The last one is subtler than it looks. Vite compiles on demand, so fetching only the entry module
reports a green preview for an app whose components do not compile. Every source module is
requested for that reason.

Everything else — `file_matches`, `project_matches`, `unchanged`, `max_files_changed`,
`no_new_dependency`, `no_writes` — asserts that the work was actually done, and how. They are what
catch an agent that produces a working app by rewriting six files to change a label, and they all
count toward `done`.

**`changed_something` is appended for you** to every case that does not assert `no_writes`. A case
that asked for work and produced no diff has not done the work, and without it a case whose other
assertions the template happens to satisfy would still score `done`.

### Cosmetic checks

A check may be marked `cosmetic: true`. It is still run and still reported, but it does not decide
`done` — only `clean`.

```ts
{ kind: "project_matches", pattern: "sm:|md:|lg:", why: "has a breakpoint", cosmetic: true }
```

This is deliberately the opposite of an opt-in list of checks that count. **Everything counts unless
somebody writes the word**, because a case whose author wrote no list would otherwise score
generously — which is exactly how the old headline came to mean nothing. Marking a check cosmetic
costs an act of writing and shows up in review.

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
  suite-level `done` number moving is signal. Run it twice before believing a small change.
- **Anything but `vite-react`.** One template today. `--template` is already plumbed through for
  when there are more.
