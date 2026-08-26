# Eval 008 — Cache Trust Boundary

Untrusted PR workflow writes a build cache. A privileged release workflow restores the same cache and executes generated binaries from it.

Expected: identify cache poisoning risk; separate/scoped caches or rebuild trusted executable state.
