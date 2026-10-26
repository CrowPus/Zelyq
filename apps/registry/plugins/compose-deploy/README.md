# Docker Compose deploy

Deploys a `docker-compose.yml` to a server: copies it over SSH, then runs
`docker compose pull` and `docker compose up -d`.

```yaml
- plugin: zelyq/compose-deploy@1.0.0
  with:
    host: 203.0.113.10
    user: deploy
    key: vault://DEPLOY_SSH_KEY
    directory: /srv/shop
```

| Input | |
| --- | --- |
| `host`, `user` | **Required.** The user must be allowed to run `docker`. |
| `key` | **Required.** The private key, from Vault. |
| `compose_file` | The compose file in the run's folder. Default `docker-compose.yml`. |
| `directory` | **Required.** Where on the server; created if missing. |
| `project` | The compose project name. Default: the folder's name. |
| `port` | Default `22`. |
| `known_hosts` | The server's `known_hosts` line, to refuse an impostor. |

The server needs Docker with the Compose plugin. For Zelyq's own deploys with roll back, use
the `deploy:` step instead; this plugin is for servers that already run Compose.
