# The Engineering Research Book

## Zelyq engineering application register

Version: 1.0

Status: Active

Approved by: Mohamed Sesay, Zelyq founder

Approval date: 2026-08-25

---

## Purpose

This register is the authoritative index of active, proposed, rejected, deferred, implemented, evaluated, expired, and superseded book records that apply research to Zelyq engineering work.

An entry appearing in this register does not authorize code by itself. Code work is allowed only when the referenced record has a status that permits it under [Research-to-code governance](../00-front-matter/10-research-to-code-governance.md).

## Current authorization state

> ZED-0001's Phase 1 is implemented within its recorded boundary and has passed independent implementation verification. A real incident on 2026-08-26 (the founder's own first live test producing 22 unrequested files) exposed a gap the review process missed and has since been fixed and live-verified. The pre-registered acceptance criteria have been run for real and independently verified, with real rough edges on record rather than smoothed over. A sixth review round found the incident fix itself had shipped under-governed (a real authority change recorded as none) and with a literal, if inert, violation of the default-mode-unaffected criterion (a trailing newline) — both corrected 2026-08-26, gates re-passed. Two more gaps are named and still open: the cap's false-positive direction is untested, and its "new file" count is really a "distinct write_file path" count, not quite the same claim. No other engineering entry, standing policy, experiment, or emergency record has been approved through this book.

## Zelyq engineering entries

| ID | Title | Status | Owner | Research dependencies | Implementation references | Last reviewed | Successor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ZED-0001](entries/ZED-0001-engineer-mode.md) v1.11 | Engineer Mode — an opt-in senior-engineering behavior profile for the Zelyq build agent | Implemented; acceptance criteria run and independently verified (Phase 1) | Principal AI Engineer seat (author; not a deciding reviewer on Gates 2–3) | ERB-01-S, ERB-02-S, ERB-03-S, ERB-04-S, ERB-05-S, ERB-06-01, ERB-06-02, ERB-06-03, ERB-06-04, ERB-06-06, Version 1 synthesis, plus prior empirical finding `020` | `e3079cd` (skill content), `c37350b` (Phase 1 code), `db55ec6` (review fixes), `968fbe4` (incident fix), `cae4169` (eval-harness `engineerMode` support), plus the trailing-newline fix (uncommitted), on `feat/skills`, not yet merged | 2026-08-26 (eleven revisions across two days; implemented, live-verified, independently code-reviewed twice more, corrected after a real live incident, formally evaluated against its own pre-registered acceptance criteria, and that evaluation independently re-verified) | ZED-0002 (Phase 2, not yet created) |

## Standing engineering policies

| ID | Title | Status | Owner | Scope | Mandatory review | Last reviewed | Successor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | No policies | — | — | — | — | — | — |

## Experiment entries

| ID | Title | Status | Owner | Research question | Authorized environment | Last reviewed | Outcome record |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | No experiments | — | — | — | — | — | — |

## Emergency records

| ID | Title | Status | Authority | Incident | Retrospective review | Last reviewed | Successor entry |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | No emergency records | — | — | — | — | — | — |

## Register rules

- Allocate identifiers sequentially within each record type.
- Never reuse an identifier.
- Add a record when it is proposed, not only when it is approved.
- Keep rejected, withdrawn, expired, and superseded records visible.
- Update status, review date, and successor links when a record changes.
- Do not list an implementation reference unless it cites and remains within the authorizing record.
- Resolve any disagreement between this register and an entry by treating the more restrictive status as authoritative until corrected.

## Register approval

Decision: **Approved as the active engineering application register.**

Approved by: Mohamed Sesay, Zelyq founder, on 2026-08-25.

This approval establishes the index and its controls. It does not create or approve an engineering entry, standing policy, experiment, emergency record, implementation, or code.

## Templates

- [Zelyq engineering entry](templates/01-engineering-entry.md)
- [Standing engineering policy](templates/02-standing-policy.md)
- [Experiment entry](templates/03-experiment-entry.md)
- [Emergency engineering record](templates/04-emergency-record.md)
