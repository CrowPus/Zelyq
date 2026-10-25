# npm publish

Publishes the package in the run's folder to npm, with a token from Vault. The token is written to
a temporary `.npmrc` only for the publish.

```yaml
- plugin: zelyq/npm-publish@1.0.0
  with:
    token: vault://NPM_TOKEN
    directory: packages/ui
```

| Input | |
| --- | --- |
| `token` | **Required.** An npm access token (Automation or Granular) that may publish it. |
| `directory` | The package's folder. Default: the run's folder. |
| `tag` | The dist-tag. Default `latest`. |
| `access` | `public` or `restricted`. Default `public`. |
| `registry` | Another registry, e.g. GitHub Packages. Default npm. |
| `dry_run` | `true` to check without publishing. |

Output `version`: the version from `package.json`. Runs on runners with Node.js and npm.
