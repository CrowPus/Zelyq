# Governance

This document states how Zelyq is governed: who the maintainers are, how
changes are approved, how disagreements are resolved, and how someone
becomes a maintainer.

## Maintainers

The current maintainer list, responsibilities, and per-area ownership are in
[`MAINTAINERS.md`](./MAINTAINERS.md). The `.github/CODEOWNERS` file routes
review requests by area and is kept in sync with that list.

## How a change is approved

- **Small fixes** (typos, docs, bugfixes with a clear scope) need no ceremony:
  open a PR and it is reviewed and merged by a maintainer when CI is green.
- **Large changes** (interface changes, new dependencies, anything touching
  runtime behaviour, or any change taking more than a day) must be **discussed
  first** — open an issue or a discussion before building. A PR for a large
  change that was not discussed first will be sent back for a proposal.
- **One concern per pull request.** A bug fix and a refactor in the same diff
  is two PRs.
- Every PR keeps `main` **releasable**: CI must be green, and behaviour
  changes must update the docs in the same PR.
- A PR is **approved** when a maintainer reviews and approves it and CI
  passes. The approving maintainer merges it (subject to the release rules
  below).

## Release rules

Changes affecting security-sensitive areas (`SECURITY.md`, auth, secrets,
DB schema, runtime, CI workflows) require the **senior maintainer's approval**,
never a casual review, regardless of who authored the change.

## How disagreements resolve

1. **Ask for a second review.** Any maintainer may request a second opinion on
   a contentious PR before it merges.
2. **Escalate to the senior maintainer.** If two maintainers disagree, the
   senior maintainer makes the call after hearing both positions.
3. **Lazy consensus with a window.** For non-urgent policy decisions, a
   maintainer may post a proposal and wait a reasonable window (typically
   **72 hours**) for objections before acting. A veto by any maintainer halts
   the action until the disagreement is resolved under (2).
4. **No unilateral reversals.** A merged change is not reverted unilaterally;
   anyone may open an issue proposing a revert, and the normal review process
   applies.

## How someone becomes a maintainer

- **Nomination.** An existing maintainer nominates a contributor. Any
  maintainer may nominate.
- **Track record.** The nominee should have a history of good reviews, sound
  technical judgement, and respectful interaction in the community.
- **Consensus.** A nomination is accepted by maintainer consensus under the
  resolution rules above; a single blocker vetoes the nomination.
- **Granting access.** Once accepted, the senior maintainer adds the nominee
  to `MAINTAINERS.md` and `.github/CODEOWNERS`, and grants the GitHub
  permissions that match the agreed responsibilities.
- **Rotation & removal.** A maintainer who is inactive or repeatedly violates
  the project's conduct rules (see `CODE_OF_CONDUCT.md` and `CLA.md`) may be
  removed by the same consensus process.

## Amending this document

Changes to `GOVERNANCE.md` itself follow the normal PR process but are
treated as a large, deliberate change: they require discussion first and
maintainer consensus, per the resolution rules above.
