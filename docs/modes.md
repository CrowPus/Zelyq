# Modes and specialists

Zelyq's agent has one default behaviour and three optional modes, plus a
roster of named specialist agents it can call. You switch modes from the
row of buttons under the composer; specialists are called for you, or on
request.

---

## The composer button row

| Button | What it does |
| --- | --- |
| 🧭 **Compass** | Architect Mode on/off |
| 👷 **Hard hat** | Engineer Mode on/off |
| ∞ **Infinity** | Auto Mode on/off (only with Architect Mode) |
| ⓘ **Info** | keyboard shortcuts popover |
| 📎 **Paperclip** | attach files / images to the prompt |
| **Model** | per-conversation model override (the instance default otherwise) |

`/` in the composer opens a menu of loaded **skills**, **plugins**, and
**models**, filtered as you type.

Architect and Engineer Mode are mutually exclusive — turning one on turns
the other off. All mode toggles are **per conversation**, not saved
settings: a consequential mode is never silently still on from a session
you forgot about.

---

## Default mode

No mode on. The agent plans lightly, makes the change you asked for, runs
the project's own typecheck (or build) and checks the preview before it
calls the turn done, and reports what it changed. Good for a concrete,
bounded edit: *"add a pricing page with three tiers and a monthly/annual
toggle, linked from the header."*

---

## Engineer Mode — 👷

Adds discipline on top of the default, for work you want to be able to
trust and review:

- **Purpose up front.** Every turn that changes something starts by
  stating the goal, who it's for, and what "done" means.
- **What it verified vs. inferred vs. assumed** — stated separately, not
  blurred into one confident paragraph.
- **The alternative it didn't pick** — when a real choice existed (an
  architecture, a library, a tradeoff), it names the road not taken and
  why.
- **Stops and asks** on anything irreversible (deleting data, an action
  with no undo) or on a request that's really a conversation ("I want to
  test you", "how would you build X") rather than a spec.

Use it for multi-file features, refactors, anything with a decision in it.

---

## Architect Mode — 🧭

Turns a vague or large request into a real design package **before any
code is written**, then builds to it.

1. **Interview.** One focused question per turn — purpose and users, the
   core requirements, non-goals, constraints, data, dependencies, failure
   expectations, acceptance criteria. The answers land in
   `architecture/requirements.md` as you go.
2. **Design package.** Written to `architecture/`:
   - `decisions/NNNN-*.md` — one record per consequential choice, with the
     alternatives and why they lost (immutable history; a changed decision
     is a new superseding record).
   - `data-model.md`, `api.md`, `infrastructure.md`
   - **`DESIGN.md`** — the design system: the product feel, colour roles,
     type scale, spacing, components, states. A first draft here; the
     Designer agent (below) owns and deepens it.
   - `build-plan.md` — an ordered work breakdown, each task review-sized
     with its own acceptance criteria, and a `## Definition of Done`.
   - `report.html` — a designed one-page overview you read in the **Plan**
     tab instead of opening seven files.
3. **It waits for you.** Nothing is built until you review the package and
   say *"build it"*.
4. **Build.** The Architect dispatches each build-plan task to a bounded
   builder — it does not write application code itself. Large apps may
   take more than one pass; reply *"keep going"* for another.
5. **Verify.** A separate session builds the project, starts the preview,
   walks the core flows on the running app, fixes small breakages, and
   returns a completion checklist — relayed to you verbatim.
6. **Design.** If — and only if — verification passed, the **Designer
   agent** is dispatched to apply `DESIGN.md` (see below), followed by a
   re-verify.
7. **Done** is claimed only when the verify checklist is clean, the design
   pass changed files, and the re-verify is clean. Never "production-ready"
   — only what was actually checked.

If you'd rather build it yourself: turn Architect Mode off, Engineer Mode
on, and hand `build-plan.md` to the Engineer one task at a time. That path
always works.

**Stopping mid-plan.** Say "stop" / "pause" / "just build it" and the
Architect talks it through: where the plan stands, what finishing buys
you, and — if you insist — that what you want now is the Engineer, not the
Architect, with the steps to switch.

---

## Auto Mode — ∞

A modifier on Architect Mode. With Auto on, after you say "build it" the
Architect runs pass after pass on its own — build, verify, design,
re-verify — until the plan is done or it hits a ceiling, instead of you
typing "keep going" between passes.

- **Ceiling:** 6M tokens / 6 passes / 30 minutes for one Auto run,
  whichever comes first. Hitting it stops the run and hands back with the
  real totals; start Auto again (a deliberate second go-ahead) or continue
  manually.
- **Stuck detection:** two passes in a row with no build-plan progress
  stops the run.
- **The Stop button is always live**, and every pass streams — you can
  watch and stop at any point.

Off by default, per conversation.

---

## Specialist agents

Named agents the Architect (and, on request, the Engineer) can call. Each
owns a slice of "done" and its work streams into the chat as a labelled
sub-thread so you can see which agent is on the job and what it's doing.

### The Designer agent

Makes a working app look like a senior design team shipped it, and owns
the project's design system.

**When it runs:**
- **Architect Mode** — automatically, after a build verifies clean.
- **Engineer Mode** — when you ask: *"make it look professionally
  designed"*, *"remove the AI-made look"*, *"hand it to the designer"*.
  The Engineer calls `design_pass`; it is not general orchestration.

**What it does, in order:**
1. **Surveys** the project — opens the preview, inspects every primary
   screen, lists what's generic / inconsistent / unstyled / broken.
2. **Owns `DESIGN.md`** — deepens the Architect's draft with real values
   (hex, a type scale, spacing steps), or **authors one from the project**
   if there is none (at `architecture/DESIGN.md`, or `DESIGN.md` in the
   repo root for a project with no `architecture/` folder). Your hand-edits
   to `DESIGN.md` are respected — it refines around them.
3. **Implements** `DESIGN.md` — tokens in the real place, then the app
   screen by screen: hierarchy, density, state coverage, responsiveness,
   motion.
4. **Fixes UI issues** it found. A non-UI problem (a broken API call, a
   data bug) it reports for the Engineer — it does not touch it.
5. Returns a **design review** leading with what `DESIGN.md` now says.

**What it will not touch.** Client UI files and `DESIGN.md` only — the
server, the database schema, build config, `package.json`, `.env`, and the
rest of `architecture/` are refused. It adds no features, no routes, no new
screens, and can only install styling/icon utilities.

**Honest outcomes.** A design pass that changes nothing, or only writes
`DESIGN.md` without implementing it, or restyles code without ever
establishing a `DESIGN.md`, comes back as "not done" with what actually
happened — never dressed up as a redesign.

**`DESIGN.md` is yours to steer.** Open it after a pass, disagree with the
palette or the type, edit it, and the next design pass builds to your
version.

---

## Which to use

| You want | Use |
| --- | --- |
| A specific, bounded change | Default |
| A feature or refactor you'll review | Engineer Mode |
| A whole app or subsystem, planned first | Architect Mode |
| …and you don't want to babysit the passes | Architect + Auto Mode |
| The existing app to look professionally designed | Engineer Mode → *"make it look professionally designed"* |
| To build it yourself from a plan | Architect Mode to plan, then Engineer Mode task by task |
