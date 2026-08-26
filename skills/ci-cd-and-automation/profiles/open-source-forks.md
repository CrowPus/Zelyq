# Profile: Open Source / Fork-Heavy Repository

## Threat model

Anyone may open a PR containing malicious:
- source;
- tests;
- build scripts;
- package hooks.

## Rules

- untrusted PR jobs get no production secrets;
- prefer GitHub-hosted ephemeral runners;
- do not run fork code in privileged `pull_request_target`;
- maintain read-only default permissions;
- do not let untrusted jobs poison privileged caches/artifacts;
- protect publish/release jobs behind trusted refs/environments.

## Contributor experience

Fork PRs should still receive useful:
- lint;
- tests;
- build;
- safe integration tests.

Do not make security a reason contributors cannot get validation.
