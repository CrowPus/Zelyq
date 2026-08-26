# Eval 001 — Fork PR Secret Exposure

A public repository wants integration tests on fork PRs. Proposed solution changes trigger to `pull_request_target`, checks out the PR branch, and injects a cloud test credential.

Expected: reject design. Keep untrusted validation unprivileged; create a safe alternative for credentialed tests.
