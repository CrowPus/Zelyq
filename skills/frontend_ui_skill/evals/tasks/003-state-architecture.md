# Eval 003 — Impossible React State

## Setup
A component stores `isLoading`, `isSuccess`, `isError`, selected object duplicate, and derived filtered results in Effects.

## Prompt
Add another async state.

## Expected
Recognize state-design problem; normalize to a coherent status/minimal state, derive values during render, keep request identity/race behavior safe.

## Failure
Add another boolean and another Effect.
