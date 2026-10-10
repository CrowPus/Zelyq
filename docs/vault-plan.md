# Vault: plan (superseded)

> **Superseded by [vault-standalone-plan.md](./vault-standalone-plan.md).** This first plan put
> Vault inside a coding project; Vault is now a module of its own, owned by the team. Kept for
> history. The user guide is [vault.md](./vault.md).

> **Status (2026-10-10): built.** V1 to V5 are implemented on `feat/vault`. Where the build
> differed from this plan, the text below says so under "As built".

Vault is Stage 1 of [platform-integration.md](./platform-integration.md): a project's secrets,
in one place, encrypted, with a record of who touched them. It replaces CrowStore from the old
platform. Only the parts a developer needs on day one come across.

## Starting point: what Zelyq already has

Zelyq **already stores secrets**. It does this quietly, inside the backend configuration:

- `packages/core/src/project-runtime.ts` (`backendConfigurationSchema.secrets`): a map of
  `NAME → value`. Names must match `^[A-Z][A-Z0-9_]{0,63}$`. Values are write-only, and `null`
  clears one.
- `apps/server/src/services/project-backend.ts`: the whole configuration, secrets included, is
  encrypted with `SecretBox` and saved in the `settings` table under
  `project-backend:<projectId>:<environment>`, for `development`, `test` and `production`.
  `previewOptions()` copies the **development** secrets into `backendEnv`, so they reach the
  project's Python backend as environment variables. The `reserved` regex refuses names such as
  `VITE_*`, `DATABASE_*` and `ZELYQ_*`.
- `apps/web/src/components/BackendPanel.tsx`: the "Backend secrets" fieldset. You add a name and
  a value, or tick to remove one; values are never shown again.
- Editor role to change them, and `project.backend.updated` in the audit log. The audit entry does
  not say *which* secret changed.

What already works, and Vault must keep:

| Property | Where it holds today |
| --- | --- |
| Encrypted at rest with AES-256-GCM | `SecretBox` (`services/secrets.ts`) |
| Values never reach the browser bundle | `reserved` blocks `VITE_*`; `preview-env.ts` returns public values only |
| The agent never sees a value | Values exist only in `backendEnv`; agent prompts say to use placeholders |
| Shell exfiltration is refused | `packages/tools/src/shell.ts` guards |
| Changing a value restarts the preview | `runtime.stopPreview` in `routes/project-backend.ts` |

What is missing, and why Vault exists:

- Secrets are buried in one dialog that only appears on Python projects.
- No history: an overwritten value is gone.
- No way for an authorised person to read a value back.
- The audit log says "backend updated", not "Ama changed `STRIPE_KEY`".
- One encrypted blob per environment: nothing can be listed, queried or versioned per secret, and
  pipelines (Stage 2) have nothing they can reference.

## What comes across from CrowStore, and what does not

CrowStore has ten tabs and about 6,000 lines. Vault v1 takes the core and leaves the rest.

**In v1:**

| From CrowStore | In Vault |
| --- | --- |
| Create / list / update / delete secrets | Same. Values are never in a list response |
| View (decrypt) a value | **Reveal**, recorded in the audit log every time |
| Versions + rollback (`secret_version.py`) | Same, last 20 versions kept per secret |
| Import `.env` (`import-env`) | Same: paste or upload, choose skip or overwrite for existing names |
| Access log (`SecretAccessLog`) | Zelyq's existing audit log, with the secret's name |
| Description | Same |

**Changed on purpose:**

| CrowStore did | Vault does | Why |
| --- | --- | --- |
| One value per secret, no environments | One value **per environment** (development / test / production) | Zelyq's backend config already has these three; pipelines and deploys will need them |
| A per-secret access token, shown once, needed to view | Your team role decides | One permission system, not two. The token was the clumsiest part of CrowStore (it even had a "recover token" endpoint) |
| Admin role to view | Editor role to reveal | An editor can change the code that reads the variable, so the admin rule was protection in appearance only. Every reveal is audited instead |
| Tier limits (5 secrets free) | None | No billing in Zelyq |

**Not in v1** (each is a separate addition later, if people ask):

Share links · promotion between projects (environments cover the common case) · rotation
schedules · cloud sync (AWS / GCP) · leak scanner · dependency map · transit encryption ·
service keys (these return as project API keys in Stage 3) · secret webhooks · expiry dates ·
categories and types · access counters (the audit log already answers this).

## Design

### Data

Two new tables, in both `schema/sqlite.ts` and `schema/pg.ts`. The parity test fails until both
match.

```
vault_secrets
  id            text  pk               "vsec_…"  (newId)
  project_id    text  not null         → projects.id, cascade on delete
  name          text  not null         ^[A-Z][A-Z0-9_]{0,63}$
  environment   text  not null         development | test | production
  value         text  not null         SecretBox ciphertext ("v1.iv.tag.data")
  description   text  null
  version       int   not null         current version number
  created_by    text  null             → users.id, set null
  updated_by    text  null             → users.id, set null
  created_at    text  not null         ISO-8601, as everywhere in Zelyq
  updated_at    text  not null
  unique (project_id, name, environment)

vault_secret_versions
  id            text  pk
  secret_id     text  not null         → vault_secrets.id, cascade
  version       int   not null
  value         text  not null         ciphertext of that version
  created_by    text  null
  created_at    text  not null
  unique (secret_id, version)
```

There is one row per name per environment, so `STRIPE_KEY` in development and `STRIPE_KEY` in
production are separate rows with separate histories. This is the simplest shape that pipelines
and deploys can read directly.

### Who can do what

Only `access.requireProject(user, projectId, role)`. No new permission table.

| Action | Minimum role |
| --- | --- |
| List names, environments, descriptions, who/when | viewer |
| Create, update, delete, import, rollback | editor |
| Reveal a value | editor, and recorded in the audit log |
| See version history (metadata only) | viewer |

As in `access.ts`, a non-member gets "not found", never "forbidden".

### API

All under the existing project routes, in a new `apps/server/src/routes/vault.ts`:

```
GET    /api/projects/:id/vault                       list (no values)
POST   /api/projects/:id/vault                       create   { name, environment, value, description? }
PATCH  /api/projects/:id/vault/:secretId             update value and/or description → new version
DELETE /api/projects/:id/vault/:secretId
POST   /api/projects/:id/vault/:secretId/reveal      → { value }       (POST so it is never cached or prefetched)
GET    /api/projects/:id/vault/:secretId/versions    metadata only
POST   /api/projects/:id/vault/:secretId/rollback    { version } → becomes a new version
POST   /api/projects/:id/vault/import                { environment, content, overwrite }
```

New audit actions in `packages/core/src/models.ts`: `vault.secret.created`, `.updated`,
`.deleted`, `.revealed`, `.rolled_back`, `vault.imported`. The audit detail always carries `name`
and `environment` and **never** a value.

### Where the values go

**`ProjectBackendService.previewOptions()` reads secrets from Vault instead of `config.secrets`.**
Only the source changes: the same names reach the same `backendEnv`, so a running app's code
changes by zero lines. The `reserved` rule moves into Vault's name validation, so `VITE_*`,
`DATABASE_*` and the rest are still refused. That is what keeps a secret out of the browser
bundle.

Any change to a development secret stops the preview, exactly as saving the backend config does
today.

### Moving existing secrets (the part that must not break anyone)

Existing secrets are inside encrypted JSON, so a SQL migration cannot reach them; only the server
holds the key. So the move happens in TypeScript, at server start, once:

1. For each `project-backend:*` settings row: decrypt it, and for every `config.secrets` entry
   insert a `vault_secrets` row (version 1) **if that name and environment does not already
   exist**.
2. Re-save the configuration with `secrets: {}`.
3. If a row cannot be decrypted (lost key), skip it and log it. Today's behaviour for that case is
   already "reconnect the backend".

It is safe to run on every boot: once moved, there is nothing left to move. A test covers it:
seed the old shape, start, and assert that the same environment reaches `previewOptions()`.

Then `secrets` is removed from `backendConfigurationSchema` and `BackendConfiguration.secretNames`,
and the "Backend secrets" fieldset in `BackendPanel.tsx` becomes a link: "Secrets are in Vault".
An old client that still sends `secrets` gets a clear 400 with the same message, not a silent drop.

### The UI

A **Vault** button in the project header, beside Git and Backend, using the same panel pattern as
`BackendPanel`. It shows on **every** project, not only Python ones.

- Environment switcher (development / test / production)
- Table: name, description, last changed by and when. Values are always `••••`.
- Add / edit: name, value (password field), description.
- Reveal: shows for 30 seconds with a copy button, then hides again.
- History drawer: versions with who and when, and a "Restore" button.
- Import `.env`: paste or choose a file, preview the names found, skip or overwrite.
- An honest note on projects with no backend: "Values reach this project's backend. A frontend-only
  project has nowhere to use them yet; pipelines will."

### The agent

- It is told the **names** (and which environments have them), never values, through a
  `list_vault_secrets` tool.
- The agent **cannot** create, reveal or change a secret. A person does that.

**As built:**
- The tool reuses the **preview bridge** rather than a new bridge. That grant is already minted
  for every agent session, scoped to one session, project and user, and it is the grant that
  starts the preview *with* these secrets. The server endpoint
  (`GET /api/internal/vault/names`) re-checks team membership on every call, so someone removed
  from the team mid-session loses access at once. The tool is hidden when there is no grant.
- The plan assumed `detect_missing_secret_declarations` was an existing tool. It is not: it is a
  name the prompts mention, with no implementation. Instead, the agent's prompt now has one rule:
  a credential the app itself uses on its server lives in Vault. Check `list_vault_secrets`, read
  it from the environment by that name, and if it is missing, name it for the user. Never ask for
  a value in the chat.

## Build order: one PR each

| PR | Contains | Proven by |
| --- | --- | --- |
| V1 | Tables (both dialects), migrations, repository | Schema parity test; repository tests on SQLite and PG |
| V2 | `VaultService` + routes + audit actions | Tests: role matrix, values never in a list or the audit log, ciphertext in the DB is not plaintext, a reveal is audited, rollback creates a new version |
| V3 | `previewOptions` reads Vault, the boot-time move, `secrets` removed from the backend config | Seed the old shape → start → identical `backendEnv`; an app with a secret still runs in preview |
| V4 | Vault panel in the web app | Used in the browser: add, reveal, edit, restore, import |
| V5 | Agent: `list_vault_secrets` + missing-secret hint | A prompt that needs a key asks for it by name and never writes a value |

**Vault v1 is done when:** in a Python project, a user adds `STRIPE_KEY` in Vault, the agent
builds code that reads it, the preview works, the audit log shows who added it, and no value ever
appeared in the browser, the agent's context, a list response or a log.

## As built: other decisions worth knowing

- **One write at a time per process for Vault.** libsql starts a SQLite transaction with a
  *synchronous* `BEGIN IMMEDIATE`, so a second transaction in the same process blocked the event
  loop while the first waited to commit, and failed with `SQLITE_BUSY`. A concurrency test found
  it. `packages/db/src/repositories/vault.ts` queues Vault's write transactions in-process.
  Other repositories that use transactions have the same latent trap.
- **The preview's revision includes a Vault fingerprint** (ids and version numbers, never
  values). A running preview is reused while the revision is unchanged, so without this a Vault
  change could leave the app running with the old value.
- **Secrets not yet moved still work.** If the startup move fails part-way, `previewOptions`
  still passes the old values (Vault wins where both exist), and a backend save carries them
  over. Nothing can be lost between the two places.
- **The Drizzle snapshot was stale** (migrations 0018 and 0019 were written by hand), so
  `db:generate` tried to re-create video tables. `0020_vault.sql` holds only the Vault statements,
  and the new snapshot is accurate again.
- **Verified for real**, beyond the tests: a React + FastAPI project's running backend received
  the values (checked by hash), a change stopped the preview and the restart picked up the new
  value, and the Vite frontend process had no secret in its environment.

## Risks

- **A lost master key loses every secret.** This is already true for API keys and backend config,
  and documented. Vault makes it matter more, so `self-hosting.md` now says so in its backup table.
- **Re-encrypting with a new master key** is not in v1. The `v1.` prefix on every ciphertext is
  what makes adding it later safe.
- **Fork safety:** the move in V3 is the one irreversible step, which is why it never deletes from
  the old config until the Vault row has been written.
