# Vault

Vault is where a team keeps its credentials: API keys, passwords, tokens. Each one is stored once,
encrypted in the database, and used from anywhere: in an app's variables, in Settings, and from your
own servers and CI.

Vault is optional. Anywhere a credential is entered, you can **type it** right there (it is
encrypted and saved the same way) or **pick it from Vault**. Choose Vault when the same key is used in
more than one place, or when someone outside Zelyq needs to fetch it.

- [Secrets](#secrets)
- [Using a secret in an app](#using-a-secret-in-an-app)
- [Using a secret in Settings](#using-a-secret-in-settings)
- [Service keys: Vault from outside Zelyq](#service-keys-vault-from-outside-zelyq)
- [zelyq vault run](#zelyq-vault-run)
- [Supabase Edge Functions](#supabase-edge-functions)
- [Who can do what](#who-can-do-what)
- [What Vault never does](#what-vault-never-does)

## Secrets

Open **Vault** in the sidebar. You see the Vault of the team chosen at the top of the sidebar. If you
administer the Zelyq instance, the **Vault of** menu also offers **Instance**, which holds keys for
Zelyq itself.

- **Add secret:** a name (`STRIPE_KEY_LIVE`), the value, and an optional description.
- **One value per secret.** A test key and a live key are two secrets, for example
  `STRIPE_KEY_TEST` and `STRIPE_KEY_LIVE`.
- **Protected:** tick it on a live key. Only admins and owners can then reveal it, change it, or
  use it in an app.
- **Reveal** shows a value for 30 seconds, then hides it again. Every reveal is in the Activity tab.
- **History** keeps the last 20 values. **Restore** saves an old value again as the newest one, so
  nothing is lost.
- **Where used** shows, under each secret, which apps and Settings fields take their value from it.
  Deleting a secret that is in use first lists what will lose it.
- **Import .env** is a one-time way to bring existing keys in. The file is not kept.

## Using a secret in an app

Open an app and click **Variables** in its header. Variables are what the app is given, read on its
server with the name you choose (`os.environ["STRIPE_KEY"]`, `process.env.STRIPE_KEY`).

Each variable is either:

- **Type a value:** kept with this app only; or
- **From Vault:** a pointer to a team secret. Change the secret in Vault and every app that uses it
  gets the new value the next time it starts. The running preview restarts on its own.

A variable's name and the secret's name can differ: the app reads `STRIPE_KEY`, which points at
`STRIPE_KEY_TEST` while you build and at `STRIPE_KEY_LIVE` (Protected) when an admin switches it.

Variables reach **server code only**. A plain React app runs in the visitor's browser, where anything
it is given is public, so Zelyq never sends variables there. An app's server side is its Python
backend (the React + FastAPI template), or [Supabase Edge Functions](#supabase-edge-functions).

The agent sees variable **names**, never values. It writes code that reads them, and when a name the
code needs is missing it asks you to add it instead of making one up.

## Using a secret in Settings

**Settings → Model** (and Image generation, Video generation): every API-key field has
**Type a value** and **From Vault**. From Vault lists the secrets in the instance Vault and in every
team Vault you administer; pick one and the field shows `Vault: NAME`. Zelyq uses that secret from
then on.

API keys are never read from the server's environment. If a key is in `.env` when Zelyq starts for
the first time on this version, it is copied into Settings once, the server log names it, and you can
then delete it from `.env`.

## Service keys: Vault from outside Zelyq

**Vault → Service keys** (admins and owners). One key per system: a deploy server, a CI job, a
cluster.

When you create a key you choose:

| Option | Meaning |
| --- | --- |
| It may | `list` names, `read` values, `write` values (never a Protected one) |
| Only these names | Patterns like `STRIPE_*`; empty means every secret |
| Only from these addresses | IPs or ranges like `203.0.113.0/24`; empty means anywhere |
| Expires | An optional date |

The key (`zvk_…`) is **shown once**. Zelyq keeps only its hash. **Rotate** makes a new key with the same
settings and stops the old one at once; **Revoke** stops it. The list shows when and from where each
key was last used, and every fetch is in the Activity tab.

### The API

Send the key as `Authorization: Bearer zvk_…`.

```bash
# Names this key may see                       (scope: list)
curl -H "Authorization: Bearer $ZELYQ_VAULT_KEY" https://zelyq.example.com/api/v1/vault/secrets

# One value                                     (scope: read)
curl -H "Authorization: Bearer $ZELYQ_VAULT_KEY" \
  https://zelyq.example.com/api/v1/vault/secrets/STRIPE_KEY_LIVE
# → {"name":"STRIPE_KEY_LIVE","value":"sk_live_…"}

# Several at once                               (scope: read)
curl -H "Authorization: Bearer $ZELYQ_VAULT_KEY" \
  "https://zelyq.example.com/api/v1/vault/secrets?names=STRIPE_KEY_LIVE,DB_PASSWORD"
# → {"secrets":[{"name":…,"value":…}],"missing":[]}

# Set a value                                   (scope: write)
curl -X PUT -H "Authorization: Bearer $ZELYQ_VAULT_KEY" -H "content-type: application/json" \
  -d '{"value":"tok-123"}' https://zelyq.example.com/api/v1/vault/secrets/PIPELINE_TOKEN
```

A refusal always says why: the key is invalid, revoked or expired, lacks the scope, may not access
that name, or is used from an address it does not allow. Requests are limited to 300 a minute per key.

## zelyq vault run

Starts any program with its secrets in its environment, with nothing written to disk. The service key
is the only thing the machine needs.

```bash
export ZELYQ_URL=https://zelyq.example.com
export ZELYQ_VAULT_KEY=zvk_…            # from Vault → Service keys

zelyq vault run -- node server.js       # every secret the key may list
zelyq vault run --only STRIPE_KEY_LIVE,DB_PASSWORD -- ./deploy.sh
zelyq vault get STRIPE_KEY_LIVE         # print one value, for scripts
zelyq vault list                        # the names this key may see
```

The program gets the secrets but not `ZELYQ_VAULT_KEY` itself, its exit code is the command's, and
signals pass through. The key is read only from the environment, never from a flag, so it stays out of
shell history. The command is in `apps/cli` (`pnpm --filter @zelyq/cli build`, then
`node apps/cli/dist/index.js`).

## Supabase Edge Functions

When an app is linked to a Supabase project (Settings → Integrations), its variables are also set as
that project's **Edge Function secrets** after every change, and read with `Deno.env.get("NAME")`. The
Variables panel shows when they were last set, and **Sync now** sets them again. Only names Zelyq set
are ever removed from Supabase; secrets you set there yourself are left alone.

## Who can do what

Team roles decide, as everywhere in Zelyq.

| | Viewer | Editor | Admin / Owner |
| --- | --- | --- | --- |
| See names, history, where used, activity | ✓ | ✓ | ✓ |
| Add, change, reveal, restore a secret; use it in an app | | ✓ | ✓ |
| The same for a **Protected** secret; mark one Protected | | | ✓ |
| Delete a secret | | | ✓ |
| Service keys | | | ✓ |
| Instance Vault | instance administrators only | | |

## What Vault never does

- A value never appears in a list, an API response other than a reveal or a service-key read, a log,
  or the Activity tab.
- A value never reaches the browser bundle or the agent.
- A variable name that would be published to the browser (`VITE_…`) or that Zelyq sets itself
  (`DATABASE_…`, `ZELYQ_…`) is refused.

Three values stay outside Vault, because Vault cannot run without them: `ZELYQ_SECRET_KEY` (the key
that encrypts Vault), `DATABASE_URL`, and `ZELYQ_RUNTIME_TOKEN`. **Back up `ZELYQ_SECRET_KEY` with the
database;** without it, no stored secret can be read. See [self-hosting](./self-hosting.md).
