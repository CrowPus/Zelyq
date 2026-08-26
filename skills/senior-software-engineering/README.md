# Zelyq Senior Software Engineering Skill

This package is the general professional-engineering layer for Zelyq.

It is deliberately different from a framework-specific coding skill. Its job is to make the agent notice the things a senior engineer notices **around** implementation: requirements, invariants, failure states, authorization, data integrity, retries, compatibility, testing, observability, accessibility, SEO when relevant, performance, safe rollout, and maintainability.

## Design principle

The skill is **risk-adaptive** rather than a universal checklist.

Every meaningful task activates the core engineering workflow. Additional profiles activate based on the system:

- `profiles/public-web.md`
- `profiles/web-app.md`
- `profiles/api-service.md`
- `profiles/stateful-data.md`
- `profiles/worker-jobs.md`
- `profiles/library-sdk-cli.md`
- `profiles/high-risk.md`

This prevents nonsense such as applying SEO rules to a queue worker or demanding distributed tracing for a tiny CLI while still making sure public websites and production APIs receive the professional checks they need.

## Main file

`SKILL.md` is the capability entry point.

Detailed material is progressively loaded from `references/` so the base agent does not carry every discipline in context for every task.

## Evaluation

`evals/` contains a rubric and adversarial tasks including:
- concurrent uniqueness;
- payment retry ambiguity;
- cross-tenant authorization;
- rolling database migration;
- SEO/accessibility;
- duplicate queue delivery;
- file uploads;
- DST/timezone scheduling;
- SemVer-breaking library changes;
- third-party outages;
- existing bad-data repair;
- observability.

The evals are important: the skill should be judged by whether it changes engineering behavior, not by whether its documentation sounds senior.

## Advisory project audit

Run:

```bash
skills/senior-software-engineering/scripts/project-audit .
```

The script discovers common repository signals and suggests which lenses deserve inspection. It does **not** claim compliance or prove quality.

## Standards/research basis

See `references/standards-map.md` for the authoritative sources used when this version was authored.
