# Solution — the tool surface

Addresses findings **B1–B6**.

Tools are the agent's hands. `docs/agent-behaviour.md` already says the right thing about them —
*"the tool descriptions are prompt text too"* — and this file takes that one step further: the tool
*signatures* are prompt text too. A tool that cannot express the operation the model needs forces
the model into a worse one, and no amount of prompt wording fixes it.

Three of these six (§2, §3, §4) are the difference between an agent that works on a scaffolded
template and one that works on a real repository. That is the product's own stated direction —
"open an existing project" ships — so they are not optional polish.

---

## 1. Stop putting 92 tools in front of the model

**Fixes B1.**

### The situation

| | tools | ~tokens of schema |
| --- | ---: | ---: |
| core (`ALL_TOOLS` before plugins) | 14 | 2,318 |
| with all 22 plugin files loaded | 92 | 9,645 |

Every non-lean session gets all of them (`session.ts:1389`), filtered only for the three Supabase
tools. A session building a landing page is offered `airtable_records`, `cloudflare_pages_deployments`,
`sentry_releases`, `stripe_prices`, and `figma_file_comments`.

The system prompt currently pays for this in prose:

> This instance may load extra tools beyond the ones described so far… A tool being available is not
> a reason to reach for it.

That paragraph exists because the registry hands over tools the session has no use for. Fix the
registry and the paragraph can go.

### Option A — tool search (the platform answer, recommended)

Anthropic ships this for exactly this problem. Mark the long tail `defer_loading: true` and add a
search tool:

```ts
tools: [
  { type: "tool_search_tool_regex_20251119", name: "tool_search_tool_regex" },
  ...coreTools,                                   // 14, always loaded
  ...pluginTools.map(t => ({ ...t, defer_loading: true })),   // 78, searchable
]
```

The model searches for a tool when it needs one, and the deferred schemas do not occupy the
selection surface until then.

Two hard rules from the API: the search tool itself must **not** be deferred, and at least one other
tool must be non-deferred, or the request 400s with `All tools have defer_loading set`. Zelyq's 14
core tools satisfy the second automatically.

This is Anthropic-only. Behind the provider seam, `ConversationOptions` grows an optional
`deferred: boolean` per tool; providers that cannot defer simply send everything, which is today's
behaviour. No regression anywhere.

### Option B — relevance gating at session construction (portable, ships sooner)

Independent of any provider. `ALL_TOOLS` is already filtered for Supabase linkage; extend the same
idea:

- A **connector** tool (`github_*`, `sentry_*`, `vercel_*`, `netlify_*`, `stripe_*`, `airtable_*`,
  `figma_*`, `cloudflare_*`, `supabase_*`) loads only when that service is actually connected to the
  project or the instance has a credential for it. A `github_issues` tool with no token is not a
  capability, it is 127 tokens of schema and a wrong turn waiting to happen.
- The **inspection** families (`browser-qa`, `design-system-auditor`, `test-intelligence`,
  `static-analysis`, `deployment-readiness`, `container-inspector`, `database-inspector`,
  `documentation-generator`, `api-tester`, `project-intelligence`, `git-inspector`) already have a
  natural gate: the Architect's build plan names them per task (`tools:` line), the specialists get
  them via `SpecialistConfig.toolNames`, and `/agent` grants them. Default mode does not need all
  eleven families standing by.

Do both. Option B is a day's work and portable; Option A is the durable answer on Anthropic.

### Target

Bring the default-mode pool to **under 30**. That is roughly where selection accuracy stops
degrading, and it is still double what Claude Code ships.

---

## 2. Let the agent read a file in pages

**Fixes B2. This is the most important item in this file.**

### The problem restated

`read_file` takes `{ path }` and nothing else. Its output goes through `truncate(text, 30_000)`,
which keeps the first 70% and last 20% and drops the middle. On a file over ~30,000 characters the
agent **cannot see a band in the middle and has no tool that would let it**, while the prompt tells
it to always read before editing and `edit_file` demands an exact match.

The `PATH_CHURN_LIMIT = 8` guard (`session.ts:2310`) is the scar tissue. Its comment says it:
*"seen on a 1000-line store file with a weak model."*

### The change

```ts
schema: z.object({
  path: z.string(),
  offset: z.number().int().min(1).optional()
    .describe("First line to read (1-indexed). Use with limit to page through a long file."),
  limit: z.number().int().min(1).max(2000).optional()
    .describe("How many lines to read. Defaults to 2000."),
})
```

And change the truncation semantics for this tool specifically: when the requested range does not
fit, cut at the **end** and say so, with the line number to resume from:

```
[showing lines 1–2000 of 4,312 — call read_file again with offset: 2001 for the rest]
```

Never elide the middle of a code file. Head-and-tail truncation is right for a command's stdout
(where the interesting parts are the start and the error at the end) and wrong for source, where
every line is addressable and the model needs a contiguous, complete view of the region it is about
to edit.

### Keep `truncate()` where it belongs

`truncate()` is correct for `run_command`, `search_files`, and `preview_logs`. This change is
`read_file` only. Do not touch the shared helper.

### While you are there

`file.truncated` (set by the runtime at its 2MB ceiling, `packages/runtime/src/local.ts:39`) appends
a visible note. The tool-layer truncation appends `… [N characters omitted] …` inline but no note
about *what to do about it*. Both should end with the same actionable line: how to get the rest.

---

## 3. Return a diff after a write or an edit

**Fixes B3. Cheapest quality win in the review — two return strings.**

### Today

```
write_file → "Wrote src/App.tsx (142 lines)."
edit_file  → "Edited src/App.tsx."
```

The model has no idea whether the edit landed where it meant. Its only recourse is `read_file`, at a
measured average of 2,981 characters of result, for a change of maybe forty.

### The change

`edit_file` returns the resulting region with line numbers:

```
Edited src/App.tsx (1 replacement at line 47).

    44   const [open, setOpen] = useState(false);
    45
    46   return (
    47     <dialog open={open} aria-labelledby="title">
    48       <h2 id="title">{title}</h2>
    49       <button onClick={() => setOpen(false)}>Close</button>
```

Three lines of context either side is enough. `write_file` returns the path, the line count, and —
when the file already existed — a unified diff against the previous content, capped at ~100 lines
with a count of what was omitted.

### Why this is worth more than it looks

- The model catches its own bad edit **in the same round-trip**, instead of on the next typecheck or
  never.
- It removes a whole class of confirmatory `read_file` calls — which, per
  [01-context-and-cost.md](./01-context-and-cost.md), are the second-largest line item in the
  history at ~353,000 tokens of `read_file` results.
- It gives the *user* something real in the transcript. A diff is legible; "Edited src/App.tsx" is
  not.

### The cost, honestly

Diffs add to tool-result size, and tool results are the thing 01 is trying to shrink. A capped diff
(~100 lines / ~4,000 chars) is a good trade: it is bounded, it is what the model would otherwise
spend a 3,000-character `read_file` to obtain, and after 01 §2 the *stale* copies get cleared
anyway. Cap it and measure it.

---

## 4. Do not let two tools write the same file at once

**Fixes B4. This is a correctness bug, not a performance one.**

### The mechanism

`session.ts:2616` runs the whole batch through `Promise.all`. `editFileTool` (`files.ts:43`) is:

```
read → replace in memory → write
```

with nothing between them. Two `edit_file` calls on one path in one assistant turn both read the
original, both write, and one edit vanishes. Both report success. It is intermittent and invisible.

The system prompt actively produces this pattern — *"Batch independent work. Several tool calls in
one reply run at the same time"* — and it is right to. The batch just is not always independent.

### The change

Partition the batch before running it. Group by "resource":

- Every mutating call (`write_file`, `edit_file`, `delete_file`) keys on its normalised `path`.
- `run_command` keys on the whole project — it can create, modify, or delete anything.

Then: run everything that touches a distinct resource concurrently, and serialise within a group,
**in the order the model emitted them**. Emission order is the model's intent and must be preserved.

Read-only tools (`read_file`, `search_files`, `list_files`, the preview and inspection tools) stay
fully concurrent — they are the common case and the whole point of batching.

The tool-result array must still go back in **one** user message, in the original call order.
`addToolResults` already does this, and its comment is correct about why: *"Splitting them across
messages teaches the model to stop calling tools in parallel."* Do not change that.

### Cheap alternative if the partition is too invasive

A per-path async mutex inside `editFileTool` / `writeFileTool`. Less correct — it serialises the
write but not the ordering guarantee, and it does nothing about `run_command` — but it closes the
silent-data-loss hole in about twenty lines. Take it as a stopgap, not the answer.

### Add the test

`packages/tools/test/tools.test.ts` should grow a case that fires two `edit_file` calls at the same
path concurrently and asserts both edits are present in the result. Today that test fails.

---

## 5. Add a file-finding tool, and scope the search

**Fixes B5.**

### `find_files` (new)

```ts
name: "find_files",
description:
  "Find files by name or glob pattern, newest first. Much cheaper than listing a whole "
  + "project when you know roughly what a file is called. Use search_files to look inside files.",
schema: z.object({
  pattern: z.string().describe('Glob, e.g. "**/*.test.tsx" or "**/Button*"'),
  path: z.string().optional(),
}),
```

Respects the same `.gitignore` exclusion `list_files` already gets from `git ls-files`.

`list_files` truncates at `MAX_LISTED = 400`. On a repository the agent did not scaffold — which is
the "open an existing project" case — that cap is reached before the answer is. A glob answers the
question directly.

### `search_files`, two fixes

```ts
schema: z.object({
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional().describe('Only search matching files, e.g. "*.tsx"'),
  context_lines: z.number().int().min(0).max(5).optional(),
  max_results: z.number().int().min(1).max(200).optional(),
})
```

- `glob` maps to grep's `--include`. Searching only `*.tsx` is a common, currently impossible ask.
- `context_lines` maps to `-C`. A match with no surrounding lines usually forces a `read_file` to
  understand it — another avoidable round-trip.

Also worth knowing: the current command uses `grep -m ${max}`, which is grep's **per-file** limit,
then pipes to `head -n ${max}`. So `max_results: 50` can mean "50 matches from the first file grep
happened to reach". The `head` saves it from being unbounded, but the semantics are not what the
description promises. Fix the description or the flag; do not leave them disagreeing.

---

## 6. Make tool schemas strict

**Fixes B6.**

`toolDefinitions()` (`packages/tools/src/index.ts:84`) emits the zod-derived schema with `$schema`
stripped. Add, on the Anthropic path:

```ts
{
  name, description,
  input_schema: { ...schema, additionalProperties: false },
  strict: true,
}
```

`strict: true` is a top-level field on the tool definition — not on `tool_choice` — and requires
`additionalProperties: false` plus `required`. It guarantees `tool_use.input` validates exactly,
which turns a class of malformed-call round-trips into calls that were never malformed.

Two cautions:

- **Keep `safeParse` in `executeTool`.** Strictness is enforced by the provider that supports it;
  the local validator is what protects the other four providers and the plugin surface. Belt and
  braces, deliberately.
- **Not every schema is ready for `additionalProperties: false`.** Audit the 78 plugin schemas
  before flipping it globally; they are third-party-shaped and some may rely on pass-through.
  Ship it for the 14 core tools first, where the schemas are known.

Related, and independently worth doing: **parse tool inputs, never string-match them.** Opus 5 and
the 4.6+ family may vary JSON string escaping in `tool_use.input`. Zelyq is already clean here — the
provider hands back a parsed object — but the guards in `session.ts` do things like
`this.options.cmdDeny?.test(cmd)` on a raw command string. That is regex over a *parsed* value, which
is fine. Keep it that way; do not add any check that pattern-matches serialised tool input.

---

## What this adds up to

| change | fixes | effort | payoff |
| --- | --- | --- | --- |
| Tool search / relevance gating | B1 | medium | 92 → <30 tools; deletes a prompt paragraph |
| `read_file` offset/limit, tail truncation | B2 | small | the agent can work on real files |
| Diff back from `edit_file` / `write_file` | B3 | small | self-verifying edits; fewer confirmatory reads |
| Serialise same-path mutations | B4 | medium | closes silent data loss |
| `find_files` + `glob`/`context_lines` | B5 | small | navigation on a repo the agent did not build |
| `strict: true` on core tools | B6 | small | fewer malformed-call round-trips |

---

## What you need to do

Do **§2, §3, §4** first — they are the ones that decide whether the agent is competent on a real
codebase, and §4 is a live data-loss bug. §1 is the biggest context win but needs a design decision
(Option A vs B) first. §5 and §6 are cleanup.

**Next:** [03-api-alignment.md](./03-api-alignment.md)
