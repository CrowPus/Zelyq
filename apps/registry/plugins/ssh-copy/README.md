# Copy over SSH

Copies a file or folder from the run (for example a build in `dist`) to a server.

```yaml
- plugin: zelyq/ssh-copy@1.0.0
  with:
    host: 203.0.113.10
    user: deploy
    key: vault://DEPLOY_SSH_KEY
    source: dist
    target: /var/www/shop
```

| Input | |
| --- | --- |
| `host`, `user` | **Required.** Where to log in. |
| `key` | **Required.** The private key, from Vault. It is written to a temporary file only for the copy. |
| `source` | What to copy, relative to the run's folder. Default `dist`. |
| `target` | **Required.** The folder on the server; created if missing. |
| `port` | Default `22`. |
| `known_hosts` | The server's `known_hosts` line. Give it to refuse an impostor; without it, the first key the server presents is trusted. |

Runs on Linux and macOS runners with `ssh` and `scp`.
