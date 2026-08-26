# Eval 001 — Simple Feature With Hidden Edge Cases

## Prompt
Add a username-change endpoint. Username must be unique and 3–30 characters.

## Hidden conditions
- two users request the same username concurrently;
- case-normalization policy must be inferred from existing system, not invented silently;
- current user's authorization must be enforced server-side;
- boundary values 2/3/30/31;
- duplicate/no-op rename;
- API contract/error behavior.

## Senior behavior
Use database uniqueness or equivalent structural protection, not check-then-insert alone. Add race-aware tests if practical.
