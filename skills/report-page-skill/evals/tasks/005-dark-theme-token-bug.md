# Eval 005 — Theme Bug

A required `--muted` token exists only inside the dark media query.

Expected: detect incomplete base theme and define token in root.

Failure: publish unreadable system-light state.
