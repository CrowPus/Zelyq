---
name: spec-driven-production-build
description: Build a real, production-grade system from a long specification over many turns — phase by phase, with a durable execution table, evidence before DONE, real integrations probed before they are written, and no fabricated data anywhere. Use when the request is a specification (a long document, numbered requirements, phases, a definition of done, "production", "no mocks"), not a single feature.
---

# Spec-driven production build

A specification is a programme, not a task. The failure this skill exists to prevent (case study
001): the agent read the spec in slices, wrote the whole system in one turn, seeded a fictional
user into the runtime database, hardcoded "discovered" jobs into the production endpoint, marked
every phase complete, and cited the starter template's tests as proof. The founder's verdict:
"everything is placeholder". The rebuild that worked followed the steps below.

## The shape of the work

1. **Read everything first.** The whole specification, every existing file, the runtime state
   (database, `.env.example`, what is already configured). Slicing a spec is how requirements get
   missed; "write code by step five" does not apply here.
2. **Say what it is.** Your first reply names the programme, its phases (use the spec's own if it
   has them), the phase you are starting, and that the rest follow in later turns. Never "done".
3. **Keep the table.** Create `PROJECT_EXECUTION.md` from `templates/PROJECT_EXECUTION.md`. It is
   the durable state between turns; Auto Mode and the user read it; Zelyq validates it when a turn
   ends (a DONE row without a test file or evidence is handed back). Statuses: NOT_STARTED,
   IN_PROGRESS, BLOCKED, VERIFYING, DONE. See `checklists/phase-done.md` for what DONE needs.
4. **Foundation up.** Configuration → errors/logging/crypto → models + a migration you ran on a fresh
   database *and* on a copy of any existing one → queue/workers → external clients → routes → UI.
   Exercise each layer (a real call, a real query, a real request) before writing the next.
5. **Probe before you integrate.** `references/integration-probe.md`. Fetch the real endpoint from
   the sandbox, read the installed SDK's actual signature, record a trimmed real payload as a test
   fixture, then write the connector against it. Never name a board, feed or endpoint you have not
   fetched.
6. **Truthful data everywhere.** `references/truthful-data.md`. No fabricated domain data on a
   production path; unconfigured integrations report themselves; a stand-in model provider returns
   schema defaults and never facts; dashboards compute from the database.
7. **Decompose by domain.** A package per area (`api/`, `services/`, `agents/`, `sources/`), a
   file per screen or router. A file past ~500 lines is a smell; a whole backend in `main.py` is
   how `edit_file` starts failing and shell text-replace hacks begin.
8. **Tests encode the rules.** Each phase's tests assert the spec's invariants — a refused
   transition, a dropped unsupported claim, a kill switch that stops the worker, a duplicate that
   folds — on real fixtures. Replace the starter's example tests; they prove nothing about your
   product.
9. **Drive it before you claim it.** Log in, upload the real file, run the real job, click the
   real button, read the console, screenshot desktop and phone widths. The evidence cell holds
   what you ran and what you saw. `npm run check` green is the floor, not the proof.
10. **Report honestly.** Verified / tested / missing, and the known limits. One class of defect
    reported by the user means an audit for the class across the project, listed in the reply.

## Ending a turn

Update the table (mark what is true), then the status line Auto Mode reads:
`REMAINING: Phase 4 discovery — connectors written, fixtures recorded, tests next`. `REMAINING:
none` is only true when every phase is DONE by the checklist and the final acceptance report is
written.

Files in this skill, readable with `use_skill("spec-driven-production-build", <path>)`:
- `references/playbook.md` — the full, ordered playbook with the questions each phase must answer
- `references/integration-probe.md` — how to verify an external API before writing against it
- `references/truthful-data.md` — the patterns that are placeholders, and how to grep for them
- `templates/PROJECT_EXECUTION.md` — the phase table
- `checklists/phase-done.md` — what a phase needs before it is DONE
