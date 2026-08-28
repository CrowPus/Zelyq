---
name: product-requirements
description: Turn an app idea or feature request into an implementable product contract. Use when requirements are vague, contradictory, broad, or missing acceptance criteria; do not use for a narrowly specified code change.
---

# Product Requirements

Convert intent into a buildable slice without inventing a different product.

## Establish the contract

Before implementation, identify:

- the user and the job they are trying to complete;
- the observable outcome, not merely the requested component;
- the primary path and the most consequential failure paths;
- data created, changed, exposed, or deleted;
- roles and permissions;
- integrations and deployment constraints already present;
- explicit non-goals;
- decisions that genuinely require the user.

Inspect the repository before asking questions. Existing routes, schemas, components, conventions, and tests often answer them.

## Slice the work

Prefer the smallest vertical slice that delivers a complete user outcome. A vertical slice includes the necessary UI, behavior, persistence, error handling, and verification. Do not call a disconnected mock UI a finished feature unless the user requested a prototype.

Separate verified facts, reasonable assumptions that preserve scope, and unresolved decisions whose alternatives materially change behavior. Ask only about unresolved decisions that are unsafe to infer.

## Acceptance criteria

Write criteria as observable behavior. Include loading, empty, validation, permission, dependency-failure, retry, and cancellation states when relevant. Name compatibility expectations and the evidence that will prove completion. Avoid criteria such as “looks modern,” “works correctly,” or implementation trivia.

## Guardrails

- Preserve explicit technology, design, and scope choices.
- Do not invent pricing, legal policy, business rules, credentials, analytics claims, or production data.
- Distinguish prototype behavior from production behavior.
- If a request spans independent products, sequence complete slices rather than beginning all of them.
- End planning with outcome, in-scope behavior, non-goals, assumptions, acceptance criteria, and verification.
