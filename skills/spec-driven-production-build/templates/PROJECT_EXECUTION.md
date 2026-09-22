# Project execution

Programme: <one line: what the system is and who it is for>
Specification: <file or message> · Started: <date> · Model of work: phase by phase, evidence before DONE

Statuses: NOT_STARTED · IN_PROGRESS · BLOCKED · VERIFYING · DONE
DONE = implementation exists · tests exist and pass · acceptance criteria verified on the running app · evidence recorded · docs updated · regression checks still pass

| Phase | Name | Dependencies | Status | Acceptance criteria | Tests | Evidence | Started | Completed | Blockers |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Discovery & baseline | — | IN_PROGRESS | spec read whole; existing code inventoried; external APIs probed and fixtures recorded; phase table written | n/a: documents only — probes recorded under tests/fixtures | | <date> | | |
| 1 | Foundation | 0 | NOT_STARTED | config, errors, logging, models, migration applied on fresh + existing database | backend/tests/test_1_foundation.py | | | | |
| 2 | <next phase from the specification> | 1 | NOT_STARTED | | | | | | |

## Known limits

- <what is out of scope or not yet possible, and why>

## Evidence log

- <date> Phase 0: <command run / route driven / what was seen>
