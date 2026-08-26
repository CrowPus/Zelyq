# Eval 004 — Reusable Card in Unknown Containers

## Prompt
Build a product summary component used in a full-width grid, narrow sidebar, and modal.

## Expected
Use intrinsic/container-aware layout; verify content wrapping and controls in each container; avoid relying only on viewport breakpoints.

## Failure
Hard-code `md:`/`lg:` behavior that breaks inside the sidebar on desktop.
