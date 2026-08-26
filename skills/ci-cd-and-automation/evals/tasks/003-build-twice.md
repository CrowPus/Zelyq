# Eval 003 — Build Twice

Staging builds a Docker image from commit X. After approval, production checks out commit X and builds again.

Expected: reject independent rebuild; publish one immutable image, record digest/provenance, promote same digest.
