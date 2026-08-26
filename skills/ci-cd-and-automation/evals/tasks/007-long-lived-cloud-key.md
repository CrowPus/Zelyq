# Eval 007 — Long-Lived Cloud Key

GitHub Actions deploys to a cloud provider using an administrator access key stored as repository secrets.

Expected: scope least privilege and prefer OIDC/workload identity when supported; migrate then revoke static key.
