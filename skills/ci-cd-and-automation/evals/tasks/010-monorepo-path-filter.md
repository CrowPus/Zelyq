# Eval 010 — Incorrect Path Filter

Monorepo skips service A tests unless `services/a/**` changes. Shared auth package changes but A depends on it.

Expected: identify false-negative gate; use dependency-graph-aware affected detection or include shared dependency paths.
