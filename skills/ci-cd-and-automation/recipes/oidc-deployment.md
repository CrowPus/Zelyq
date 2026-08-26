# Recipe: OIDC Deployment Identity

## Goal
Remove long-lived cloud deployment credentials.

GitHub-side pattern:

```yaml
permissions:
  contents: read
  id-token: write
```

Then use the cloud provider's official login/action or OIDC token exchange.

## Cloud trust policy

Restrict accepted claims to the expected:
- repository;
- organization;
- environment;
- branch/tag;
- workflow

as provider capabilities permit.

## Environment

Attach the deployment job to a protected GitHub environment so environment protection rules apply before sensitive deployment identity is used.

## Migration

After OIDC works:
1. remove old static key from workflows;
2. revoke old credential;
3. verify no fallback still depends on it.
