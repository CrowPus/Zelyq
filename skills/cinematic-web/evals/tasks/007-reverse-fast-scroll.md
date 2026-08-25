# Eval 007 — Reverse and Fast Scroll

For a multi-scene pinned experience test:
- slow forward
- slow backward
- fast fling/scrollbar drag
- reload mid-page
- responsive breakpoint resize

## Expected
Visual state remains deterministic and tied to progress.

## Failure
One-way callbacks leave incorrect scene state.
