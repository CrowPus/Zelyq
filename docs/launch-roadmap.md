# Public launch roadmap

The repository is already public. This is the plan to turn it from *public* into
*launched* — able to stand up to contributor and user traffic, and honest about
what it is.

**Licensing is settled.** Zelyq is open source under the **GNU AGPL-3.0**, with a
commercial dual-licence and an open-core `ee/` split. See
[`LICENSING.md`](../LICENSING.md) and
[ADR 0005](./adr/0005-agpl-3.0-and-dual-licensing.md).

The forward-looking product roadmap is a separate document — see
[`roadmap.md`](./roadmap.md), which gets its own refresh once this list is done.

---

## Phase 1 — Say what it is  ✅

The relicence to AGPL-3.0 landed (issue [#96](https://github.com/CrowPus/Zelyq/issues/96),
closed), so every surface can say "open source" and mean it: `LICENSE`, `NOTICE`,
`LICENSING.md`, `README` + badge, `CONTRIBUTING`, `CLA`, `CHANGELOG`, the
`research/` front-matter, and every `package.json` `license` field are
consistent. The GitHub repo description already reads correctly.

## Phase 2 — Governance & sustainability

_Tracked in [#97](https://github.com/CrowPus/Zelyq/issues/97), [#98](https://github.com/CrowPus/Zelyq/issues/98)._

Contributors need to know who decides and how the project stays funded.

- [ ] `GOVERNANCE.md` — who the maintainers are, how a change gets approved,
      how a disagreement is resolved, how someone becomes a maintainer.
- [ ] `MAINTAINERS.md` — the actual list, with areas, kept in sync with
      `.github/CODEOWNERS`.
- [ ] `.github/FUNDING.yml` — the sponsor link, so "fund full-time development"
      (the stated reason for the licence) has a front door.

## Phase 3 — Contributor on-ramp

_Tracked in [#99](https://github.com/CrowPus/Zelyq/issues/99), [#100](https://github.com/CrowPus/Zelyq/issues/100); seed issues are the first task._

- [ ] Seed 6–10 real issues, a mix of `good first issue` and `help wanted`,
      each self-contained with a clear finish line (see the label's own
      description).
- [ ] A CI **licence-compliance check** — `CONTRIBUTING.md` already says a new
      dependency must be Apache-2.0 / MIT / BSD / ISC; nothing enforces it. Add
      a job that fails on a disallowed transitive licence.
- [ ] `THIRD_PARTY_NOTICES.md` (or a generated SBOM) so downstream users can see
      what they are shipping.
- [ ] Verify the clone → `pnpm dev` → PR loop on a clean machine and fix
      anything that needs a second try.

## Phase 4 — Repo polish

_Tracked in [#101](https://github.com/CrowPus/Zelyq/issues/101), [#102](https://github.com/CrowPus/Zelyq/issues/102)._

- [ ] `deploy/` — replace the box-specific values (`136.112.104.233`,
      `app.zelyq.com`, `/home/crow/...`) with `<your-vm-ip>` / `<your-domain>`
      placeholders, or move the concrete files to a private ops repo and keep
      only a generic template here.
- [ ] A social-preview image for the repo (GitHub Settings → Social preview) —
      high leverage for launch-day link shares.
- [ ] README pass: the licence badge, the nav row, and the screenshots/videos
      are current; trim anything stale.
- [ ] `CITATION.cff` — the repo carries a real `research/` corpus; make it
      citable.

## Phase 5 — First release

_Tracked in [#103](https://github.com/CrowPus/Zelyq/issues/103)._

The release workflow exists (`.github/workflows/release.yml`) and has never run.

- [ ] Finalise the `CHANGELOG.md` `[Unreleased]` section under a version
      heading.
- [ ] Tag it (`git tag -a vX.Y.0 -m "vX.Y.0"`, push the tag). The workflow
      re-runs lint/build/typecheck/test against the tag and publishes a GitHub
      Release from the changelog section.

## Phase 6 — Announce

- [ ] Short launch post (what it is, the "behaves like an engineer" thesis, the
      live demo at [zelyq.com](https://zelyq.com), a link to the release).
- [ ] Show HN / r/selfhosted / r/opensource (as "fair-code", not "open
      source") / X. One thread, linked from the others.
- [ ] Pin a "Welcome / where to start" Discussion.

## Phase 7 — Sustain

_Product-roadmap refresh tracked in [#104](https://github.com/CrowPus/Zelyq/issues/104)._

- [ ] A triage cadence: new issues get an `area:` label and a first response
      within a stated window; `needs-triage` does not pile up.
- [ ] Refresh [`roadmap.md`](./roadmap.md) into a forward-looking product
      roadmap — the current one is mostly checked-off history.

---

## Not in scope

- **Further relicensing.** The model is settled — AGPL-3.0 + a commercial
  dual-licence + the open-core `ee/` split (ADR 0005).
- **A hosted service in this repo.** Still out — see `roadmap.md`
  "Explicitly not planned".
