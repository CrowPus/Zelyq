# The playbook

What a successful spec-driven build did, in order, with the question each step answers. It is
written from the rebuild in case study 001 (a job-application agent: FastAPI, React, Gemini,
SMTP/IMAP, Playwright) but the steps are stack-independent.

## Phase 0 — discovery (one turn, no application code)

*Question: what exactly is being asked, what already exists, and what is real out there?*

- Read the specification whole. Extract: the numbered requirements, the non-negotiables (truthful
  data, human approval, kill switches, "no placeholders"), the required stack, the definition of
  done, the phases. Keep the spec's own phase names if it has them.
- Read every existing file and the runtime state. If a previous attempt exists, judge it honestly
  (a status file claiming "all phases complete" after one turn is a red flag, not a head start).
- Probe every external interface the spec names (`integration-probe.md`). Record fixtures. Note
  what needs credentials the user has not supplied — that is a BLOCKED row, not a mock.
- Check the sandbox can do what the executor needs (outbound network, a browser, a mail port).
- Write `PROJECT_EXECUTION.md` (template), `ARCHITECTURE.md` (the pipeline, the state machines,
  the decisions) and any threat/data-flow documents the spec asks for.
- First reply: the programme, its phases, what Phase 1 will do, and the blockers.

## Phase 1 — foundation

*Question: can the system boot, persist, migrate, log and fail correctly with nothing built on top?*

Configuration from the environment with a validated model; a coded error type (code, message,
retryable, requires_user_action, correlation id); structured logging with correlation ids; secrets
encryption; SSRF-safe fetching; HTML/header sanitising; explicit state machines with an allowed-edge
table; the data model as a package (a module per domain); one migration you have run on a fresh
database *and* on a copy of the existing one. Test: the migration chain builds a fresh schema; an
illegal transition raises; the SSRF guard refuses private targets.

## Phase 2 — identity, settings, integrations

Registration that closes after the first account (or the spec's rule), sessions with CSRF,
throttling, per-account encrypted integration settings with a **Test connection** that performs a
real connect. Test: CSRF enforced, second registration refused, bad password throttled.

## Phase 3 — the core domain, one agent/service at a time

For each: the deterministic part first (works without a model), then the model-backed part behind
a client that returns schema defaults when unconfigured and never invents facts. Wrap every
untrusted text in a trust boundary; scan for prompt injection; store flags. Run each one on real
input before moving on (the user's real file, a real posting) and write what happened in the
evidence cell.

## Phase 4 — external sources / connectors

One adapter per source with `search → normalise → health_check`; fingerprint-based duplicate
folding; a policy table that decides what may be automated per platform. Contract tests on the
recorded fixtures. A live run with real counts in the evidence cell.

## Phase 5 — execution (anything irreversible)

Proposal → validation → policy → preflight checks → idempotency record → deterministic executor →
verification → audit → state transition. Kill switches read before every task and inside the
executor. Unclear outcomes become an explicit *unverified* state and are never retried
automatically. Prove the executor against a target you serve yourself (a mock form server with the
scenarios: simple, upload, multi-step, validation error, CAPTCHA/login handoff, closed, duplicate)
before any real target.

## Phase 6 — background work

A durable queue in the database (claim with an atomic update), retries with back-off, a dead
letter that is visible and retryable, a scheduler whose jobs are rows the user can edit, orphan
reclaim on worker start, concurrency caps per family. Test: a paused switch stops the worker; a
stale lock is reclaimed.

## Phase 7 — the interface

One page per screen, a typed client generated from the API, live updates over SSE, light and dark
themes from the same tokens, responsive to phone width. Every state styled: empty, loading, error,
success. Every action wired to a real endpoint. Drive every route in a browser and read the console
before calling it done.

## Phase 8 — operations and production validation

Compose/containers for every process (API, worker, browser, database, cache), migrations on
start, health endpoints, retention, budgets. Update README/ARCHITECTURE/SECURITY to describe what
exists — delete the previous attempt's claims. The final acceptance report lists, per requirement,
verified / tested / missing.

## Throughout

- The table is updated at the end of every turn; DONE only by the checklist.
- One reported defect ⇒ audit for the class ⇒ list every hit ⇒ fix all.
- A file over ~500 lines gets split before it gets bigger.
- The user's real data (their CV, their mailbox) is used to verify, never invented, and never sent
  to a third party without their approval.
