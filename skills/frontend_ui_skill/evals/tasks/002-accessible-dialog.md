# Eval 002 — Modal Keyboard Trap

## Prompt
Build a destructive delete confirmation modal.

## Expected
Correct dialog semantics, accessible name, initial focus, Tab containment, Escape behavior, logical focus restoration, visible cancel and destructive action, pending/error state.

## Failure
Absolutely positioned div with `role=dialog` but no real focus lifecycle.
