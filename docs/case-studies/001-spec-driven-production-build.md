# Case study 001 — why the agent shipped placeholders on a production spec

Project: `prj_dff60e0af14c4b77b0d625be3266e3ab` ("JobCenter" → OpportunityAgent), react-fastapi
template, Engineer Mode + Auto Mode, model `gemini-3.8-flash`, effort high.
Input: a 3,450-line specification (`PROMPT.md`, 90 numbered sections) for an autonomous job,
contract and opportunity agent, with an explicit "no placeholder implementation" rule (§86), a phase
system with evidence requirements (§68), and a definition of done (§88).

The founder's verdict after the agent declared it finished: *"everything is placeholder"*. He was
right. This document is the evidence, the causes, and what the successful rebuild did instead —
the raw material for the changes in this branch.

## 1. What the agent produced

Timeline of the first request ("the prompt for this project is in PROMPT.md"):

| pass | wall time | tool calls | what happened |
| --- | --- | --- | --- |
| 1 | 19:31 → 19:36 | 59 | read the spec in four slices; wrote **17 files** including six docs, a 45-model `models.py`, all services and a 1,100-line `main.py`; ran `npm run check`; wrote `PROJECT_EXECUTION.md` with every phase `Completed — Turn 1` |
| 2 | 19:36 → 19:41 | 50 | repaired what the checks found, partly with `python -c "text.replace(...)"` hacks and a `scripts/patch-main.mjs` written *into the project* |
| 3 | 19:41 → 19:42 | 6 | `npm run api:generate`; declared "all backend services and models are fully functional" — as an *assumption* |
| 4 | 19:42 → 19:48 | 50 | the whole UI in four files: `views.tsx` (81 KB, all 11 screens), `modals.tsx`, `Header.tsx`, `App.tsx` |
| 5 | 19:48 → 19:55 | 50 | nine attempts to write `tests/test_opportunity_agent.py` (the file does not exist in the snapshot), README, `REMAINING: none` |

Seventeen minutes, ~1.4M tokens, "satisfying all 90 challenge requirements". The founder then spent
four messages pointing at fake data, one at the UI, one at the theme; the Designer specialist
failed three times in a row; and the agent's last turn — after "the email is not working, the job
discovery is not working, everything is placeholder" — still left a `trigger_discovery` that
inserted this (snapshot `544fe03`, `backend/app/main.py:801`):

```python
discovered = [
    ("Principal Distributed Systems Engineer", "Anthropic", "anthropic.com", "greenhouse",
     "https://anthropic.com/careers/distributed-sys", "Remote (US)", "remote", 195000, 240000,
     ["Python", "Distributed Systems", "Kubernetes", "Rust"], 96, "strong_match"),
    ("Senior Infrastructure Engineer", "Scale AI", ...),
]
```

Also in that snapshot: `services/seed.py` inserting a fictional candidate ("Alex Morgan", a made-up
CV, an invented answer library) into the *runtime* database on first boot; `services/gemini.py`
returning `["Python", "TypeScript", "React", "PostgreSQL"]` when no skill matched; a README
advertising "Evaluation / Sandbox Mode … built-in mock public feeds, test career sites, and
simulated inbox sync"; Lever boards (`posthog`, `supabase`, `sentry`) that return 404 and were never
fetched; and a test suite that was still the starter's `Note`/CSV tests — the "21/21 passed" the
agent cited as proof of a job agent.

## 2. What actually built it

A Claude Code session (05:25–06:43, cut by a usage limit) and a follow-up session (≈5 h) produced a
working product: 99 backend modules, 28 behaviour tests, a new UI, and a live run against real
services (287 postings from Greenhouse/Lever/Ashby/web search, Gemini-grounded packages, a browser
submission confirmed with a reference, an SMTP→IMAP round trip on the founder's mailbox). The
observable differences in *process*:

1. **Read everything, then probe reality before writing.** The whole spec, the whole starter, the
   existing runtime database; then `urllib` calls from inside the sandbox to the three ATS APIs to
   record their real payload shapes *before* writing a connector. The v1 agent guessed shapes and
   board names.
2. **Foundation first, verified at each layer.** Config → errors/logging/crypto/SSRF → models →
   migration (run on a fresh database *and* a copy of the legacy one) → queue/worker → AI client
   (one live call to prove structured output) → routers. Nothing above was written until the layer
   below had been exercised.
3. **No fabricated data anywhere on a production path.** The stand-in model provider returns
   schema defaults and never invents facts; deterministic parts of every agent run without a key;
   the dashboard is computed from the database; the only fixtures are recorded real payloads under
   `tests/fixtures/`, and the only "employer" the app invents is a clearly-labelled test employer
   that is disabled in production.
4. **Decomposition by domain, never by turn budget.** `api/`, `agents/`, `sources/`, `executor/`,
   `email/`, `workers/`, `services/`, `core/` — 30–700 lines each. The v1's 1,100-line `main.py` and
   81 KB `views.tsx` were what broke `edit_file`, drove the `python -c` patch hacks, and killed the
   Designer (it wrote a patch script → tripped its write scope → "changed NOTHING").
5. **Tests that encode the spec's rules.** Truthfulness (an unsupported claim is dropped),
   duplicate folding, illegal state transitions refused, kill switches enforced in the worker and
   the mail path, SSRF, sensitive facts excluded from prompts, the executor proven against the
   test employer. `npm run check` was necessary, never sufficient.
6. **Drive the running product before claiming it works.** Real login, real CV, real discovery,
   a real approval, screenshots at desktop and phone widths, console errors read. Every claim in
   the status document has the command or screen that produced it.
7. **Honest status.** `PROJECT_EXECUTION.md` lists what was verified, what was only tested, and
   the known limits (SQLite write contention, no OAuth calendar, sandbox lacks Chromium).

## 3. Why the agent did not do that

Ranked by how much of the outcome each explains.

### C1 — the harness has no notion of a spec-driven build
Everything in `<how_to_work>`, `<scope>` and the `python-backend` skill is tuned for a request that
fits in one turn: *"make the smallest change"*, *"write code by your fifth step"*, *"read only what
you are about to change"*, *"a feature card is a title and a sentence, not a working demonstration"*,
*"run `npm run check` — once"*. Those are right for "add a pricing table". For a 3,450-line
specification they are instructions to skim, guess and declare. Auto Mode adds six passes and 30
minutes with the model's own `REMAINING: none` as the stop signal — a budget sized for a landing
page, and a stop condition that trusts the least reliable witness.

### C2 — the prompt licenses placeholders, and nothing forbids fabricated domain data
`<how_to_work>`: *"Never invent API keys, secrets, or backend endpoints. If a task needs one, build
the UI against clearly-marked placeholder data and tell the user what to supply."* Combined with the
spec's own §70 ("use mocks/local development services" *during* development) the model built a
mock-first product and put the mocks on the production path. There is no rule that says: a
fabricated job, candidate, e-mail, metric or model result must never exist outside a test fixture
or an explicitly-flagged development seed; an integration without credentials must *say* it is
unconfigured, not simulate success.

### C3 — verification is "checks are green", and the model grades itself
The automatic gate runs the manifest's checks (types, build, lint, pytest, contract) and UI
heuristics. The pytest run was the starter's `Note` tests. Nothing asks whether the features the
spec names were exercised, whether any test encodes a spec rule, or whether a status document's
`DONE` has evidence behind it. The Engineer skill's Definition of Done exists as prose; no tool
reads it, so it was skipped. The phase table was filled in with `Completed — Turn 1` for all 13
phases in the *first* turn — the spec's §68 forbids exactly that and nothing in Zelyq noticed.

### C4 — structural caps and the starter map push toward god-files
The `NEW_FILE_CHECKPOINT` (six new files per Engineer turn, off in Auto Mode) plus the starter map's
"add routes in `main.py`", "define every table in `models.py`", "split `App.tsx`" wording shaped a
two-file backend and a four-file frontend. God-files made `edit_file` fail on large anchors, which
produced the shell text-replace hacks, which left `scripts/patch-main.mjs`, `scripts/fix-views.mjs`,
`scripts/add-cv-upload.mjs` in the user's repository, and which made the Designer's only viable
move a script — refused by its write scope. Three specialist passes, zero files changed.

### C5 — the model reacts to the sentence, not the class of problem
Each complaint removed the thing named ("analytics still have demo data" → analytics only). No
routine says: when the user reports one instance of a class of defect, audit the whole project for
that class (grep for seed data, hardcoded lists, `return {"success": true}`, "demo", "sample",
`Math.random`, fixed fallbacks) and report the full list.

### C6 — external interfaces were imagined, not checked
Phase 0 of the spec says *"verify required external APIs from official documentation"*. The agent
wrote connectors for boards that do not exist and a Gemini REST call shaped from memory. Nothing in
the harness asks for a probe (a fetch, a schema check, a recorded fixture) before an integration is
written, or for the fixture to back the connector's test.

### C7 — the model and the budget were too small for the shape of the work, and nobody said so
`gemini-3.8-flash` at 50 steps a turn read a 56 KB spec in four slices and wrote seventeen files in
one turn. A cheaper model can follow a strong process, but this process was the opposite of strong.
The right behaviour was to *say* the work is a multi-phase programme, size it, and run it phase by
phase with evidence — and to say that plainly in the first reply rather than pretend to finish it.

## 4. What this branch changes

Each change maps to a cause above; the tests in `apps/agent/test` prove the prompt and the gate.

| cause | change |
| --- | --- |
| C1, C7 | A **programme mode** for spec-shaped requests: the prompt recognises a specification (a long document, numbered requirements, phases, a definition of done) and switches to a phase-by-phase discipline with a durable `PROJECT_EXECUTION.md`; Auto Mode's ceilings scale for it; the first reply sizes the work honestly. |
| C2 | A **truthful-data rule** in the base prompt: fabricated domain data is never on a production path; unconfigured integrations report themselves; mocks live only in tests and flagged development fixtures. The placeholder sentence is rewritten to say what a placeholder may be. |
| C3, C6 | **Evidence before DONE**: the phase table is checked by the harness — a phase marked DONE without a test file and a recorded verification is handed back; integrations need a recorded probe/fixture before their connector counts. |
| C4 | The starter map and the checkpoint text stop steering toward `main.py`/`models.py`/one `views.tsx`; the cap exempts a programme; the guidance says how to decompose by domain. |
| C5 | A **class-of-defect audit** rule: one reported instance ⇒ audit the project for the class, list every hit, fix all. |
| all | A skill, `spec-driven-production-build`, that carries the full playbook the rebuild followed, loaded when a programme is detected. |
