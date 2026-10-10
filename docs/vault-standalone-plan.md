# Vault as a standalone module: plan

Status (2026-10-10): **built — phases 1 to 5 — and deployed to app.zelyq.com for testing.** Not
yet pushed to GitHub. It supersedes the scope of
[vault-plan.md](./vault-plan.md), which put Vault inside a coding project. That was the wrong
level.

## 1. What Vault is

Vault is a **module of its own**, at the same level as the app builder (Vibe), not a feature of
it. It is where a team keeps every credential it uses. Everything else *uses* Vault:

```
                        ┌──────────────── Vault ────────────────┐
                        │  team secrets · instance credentials  │
                        │  encrypted in the database            │
                        └──┬────────┬────────┬────────┬─────────┘
                           │        │        │        │
                  App builder   Pipelines  Deploy   Outside systems
                  (coding        (later)   (later)  (servers, CI,
                   projects)                         Kubernetes, scripts)
                 "From Vault"   vault://NAME         service key + API
```

Credentials do not live in `.env` files; they are kept in the database, encrypted by the system
with no key for the user to supply. **Vault is optional.** Wherever a credential is needed, the
user either **types it directly** (the default, saved encrypted where it is used) or **picks it
from Vault** in a dropdown (D0). Importing a `.env` stays only as a one-time way to move existing
keys in.

### Mapping from Crowpus

The mistake in the first build came from a naming clash, so the mapping is stated explicitly:

| Crowpus | Zelyq | Why |
| --- | --- | --- |
| Organisation | (dropped) | No organisations in Zelyq |
| **Project** (a workspace holding Vibe, CrowFlow, CrowStore…) | **Team** | The shared workspace people are invited into, with roles |
| CrowStore | **Vault** | The standalone secrets module |
| A Vibe app | A Zelyq **coding project** | One app, inside a team |
| Service API key | **Service key** (per team) | Machine access for outside systems |
| `crowstore://NAME` | `vault://NAME` | Reference resolved by the platform |

## 2. What stays outside Vault, and why

Exactly these, because Vault cannot exist without them:

| Value | Why it cannot be in Vault |
| --- | --- |
| `ZELYQ_SECRET_KEY` (or its key file) | It is the key that encrypts Vault. Storing it inside Vault would lock the key in the box it opens. |
| `DATABASE_URL` | Vault lives in the database; the server needs this to reach it. |
| `ZELYQ_RUNTIME_TOKEN` | The remote runtime host has no database access; it must get its token at boot. |

Everything else can be typed directly or taken from Vault (D0).

## 3. Decisions

Each decision states the choice and the reason. Points marked **(confirm)** are yours to decide;
the plan is written assuming the recommendation.

**D0. Every credential field offers two ways: type it, or pick it from Vault.** This applies
everywhere a credential is entered: a project's variables, the instance Settings (model API
keys, image and video keys), and later Pipelines and Deploy targets.

```
  OPENAI_API_KEY   (•) Type a value   [ ••••••••••••          ]
                   ( ) From Vault     [ OPENAI_API_KEY      ▾ ]
```

- **Type a value** is the default. The value is encrypted by the system and saved in the
  database right there. No Vault, no extra steps.
- **From Vault** shows the Vault secrets available to that place (the team's Vault for a
  project, the Instance Vault for Settings). Choosing one stores a **reference**, not a copy:
  changing or restoring the secret in Vault reaches everything that points at it.
- Switching between the two is always possible. Vault shows **where each secret is used**, and
  deleting one that is in use first lists what will lose it.
- If a referenced secret is gone, the field says so by name ("`STRIPE_KEY` is no longer in
  Vault") instead of silently sending an empty value.

**D0b. A reference needs no token.** In CrowStore a reference worked only with a token beside
it:

```yaml
GCP_SERVICE_ACCOUNT_JSON: crowstore://GCP_SERVICE_ACCOUNT_JSON
CROWSTORE_TOKEN_GCP_SERVICE_ACCOUNT_JSON: ec1d…          # had to be supplied by hand
```

In Zelyq, `vault://GCP_SERVICE_ACCOUNT_JSON` (or choosing it in the dropdown) is all there is.
The platform knows which team and project is asking, checks that it may use the secret,
decrypts it and hands it over. Nobody supplies or stores a per-secret token. A value is shown to
a **person** only through Reveal, which their role allows or refuses (D3), and which is recorded.
Machines outside Zelyq use a service key (D6), which is one key per system, not one per secret.

**D1. Two kinds of Vault.**
- **Team Vault:** one per team, owned by the team, managed by its members according to their
  role.
- **Instance Vault:** one per Zelyq installation, holding Zelyq's own credentials (model API
  keys, image and video provider keys, OAuth client secrets). Only instance administrators can
  see or manage it. It is not a team's, because those keys serve every team on the installation.

**D2. One value per secret, as in CrowStore.** *(decided)* A secret has a name and one value.
A test key and a live key are two secrets, for example `STRIPE_KEY_TEST` and `STRIPE_KEY_LIVE`,
and each place that uses one chooses which.

**D2b. Protected secrets.** *(decided: live keys are for admins and owners only)* With no
environments, "live" is marked on the secret itself: an admin or owner can tick **Protected**
on a secret such as `STRIPE_KEY_LIVE`. Only admins and owners can then reveal it, change it, or
point something at it.

**D3. Permissions follow team roles.** No second permission system.

| Action | Viewer | Editor | Admin / Owner |
| --- | --- | --- | --- |
| See names, descriptions, history, who changed what | ✓ | ✓ | ✓ |
| Create and change secrets; reveal them (audited) | | ✓ | ✓ |
| The same for **Protected** secrets (D2b); mark a secret Protected | | | ✓ |
| Delete a secret | | | ✓ |
| Point a project variable or a field at a Vault secret (D0, D4) | | ✓ (not Protected) | ✓ |
| Service keys: create, rotate, revoke | | | ✓ |
| Instance Vault | instance administrators only | | |

Reasoning: anyone who can make code run with a secret can read it, so "use" and "read" are the
same permission, and the table does not pretend otherwise. Protected secrets are stricter because
only an admin can point anything at them, so no editor action can bring one into an app.

**D4. A coding project has its own variables; each is typed or from Vault.** A project keeps a
list of the variables its app needs (`STRIPE_KEY`, `OPENAI_API_KEY`…). Each one
is either a value typed for this project or a reference to a team Vault secret (D0). Only the
project's own variables reach the app and its agent, never the whole team Vault.

**D5. Names.** A name is unique within a team Vault, and within a project's variables. A project
variable can have a different name from the Vault secret
it points at (the app reads `STRIPE_KEY`; it points at `STRIPE_KEY_TEST` while building and an admin points
it at `STRIPE_KEY_LIVE` when the app goes live).

**D6. Service keys for outside systems,** following CrowStore's model:
- belongs to one team; shown **once** when created, stored only as a hash;
- **scopes:** `list`, `read`, `write` (CrowStore's `secrets:list/read/write`; `delete` and
  `admin` are left to people in the UI);
- optional **name patterns** (`STRIPE_*`), optional **IP allowlist** (CIDR) and an **expiry**;
- rotate (new key, old one revoked) and revoke;
- every use is recorded: which key, which secret, from which IP.

**D7. Outside access is an API, not a file.** Outside systems fetch secrets over HTTPS with a
service key. There is no `.env` download. A small command (`zelyq vault run -- <command>`) that
starts a program with the secrets in its environment, without writing them to disk, comes
in phase 5.

**D8. Zelyq's own credentials live in Settings, not in `.env`.** *(decided)* Each credential
field in Settings is typed directly or taken from the Instance Vault (D0). Zelyq no longer reads
credentials such as `OPENAI_API_KEY` from `.env` or the server environment. On upgrade, any
credential still in the server's `.env` is copied into Settings once (as a typed value), and the
server log lists which ones so they can be deleted from the file. app.zelyq.com has 13 such
lines today. Only the three values in section 2 stay outside the database.

Everything about these keys happens in **Settings**: you see each one there (masked), and on each
field you decide whether it keeps its own typed value or uses a key from the Vault instead
(the **From Vault ▾** dropdown). Vault never changes a Settings field by itself.

**D9. Supabase and Figma connections are not moved into Vault.** They are OAuth connections
whose tokens refresh themselves; storing them as static secrets would break the refresh. Their
**client secrets** (`ZELYQ_SUPABASE_OAUTH_CLIENT_SECRET`, `ZELYQ_FIGMA_CLIENT_SECRET`,
`ZELYQ_OIDC_CLIENT_SECRET`) are server configuration today, not Settings fields; making them
Settings fields with D0's two options is a separate, later step.

## 4. What is reused from the current build

The first build is not thrown away. These parts are correct and stay:

- encryption (`SecretBox`, AES-256-GCM), versions and restore, the reveal flow, `.env` import;
- the audit log entries and the "never a value in a list, a response or a log" rule, with its
  tests;
- the in-process write queue that prevents the SQLite deadlock;
- the linear-time `.env` parser (the CodeQL fix);
- the agent tool (`list_vault_secrets`), which now returns the names of the project's variables;
- delivery into a running app: `previewOptions` and the Vault fingerprint that restarts the
  preview.

What changes: **where Vault belongs** (the team, with its own page), **how a credential field
gets its value** (typed, or a reference to Vault), and **what can reach Vault** (service keys and
the API). The project-level storage of the first build becomes the project's own variables
(D4), which is what it really was.

## 5. Data

```
vault_secrets                         (reworked)
  id, scope ('team' | 'instance'), team_id (null for instance),
  name, value (ciphertext), description, protected (boolean), version,
  created_by, updated_by, created_at, updated_at
  unique (scope, team_id, name)

vault_secret_versions                 (unchanged)

project_variables                     (new) what a coding project's app is given
  id, project_id → projects (cascade), name,
  source ('direct' | 'vault'),
  value (ciphertext, when direct) | vault_name (when vault),
  created_by, updated_by, created_at, updated_at
  unique (project_id, name)
  -- a 'vault' variable is resolved when the app starts, from the team Vault by vault_name,
  --  so a change or a restore in Vault reaches every app that uses it.

settings (existing)                   instance credential fields
  -- a credential setting holds either its ciphertext (typed) or a reference
  --  {"vault": "<name>"} to the Instance Vault (D8)

vault_service_keys                    (new)
  id, team_id → teams (cascade), name, key_prefix, key_hash,
  scopes (JSON), name_patterns (JSON | null),
  allowed_ips (JSON | null), expires_at, revoked_at,
  last_used_at, last_used_ip, created_by, created_at
```

Both SQLite and PostgreSQL, with the parity test extended to the new tables.

**Moving today's data:** the first build's project-owned secrets become that project's
**direct** variables (`source = 'direct'`), with their values and history kept. Nothing is renamed
or dropped, and no team Vault entry is created for you. app.zelyq.com currently has **0** of
them, so on your instance this is a no-op, but the code and its test still cover it.

## 6. API

People (signed in, team roles from D3):

```
GET    /api/teams/:teamId/vault                            names only
POST   /api/teams/:teamId/vault                            create
PATCH  /api/teams/:teamId/vault/:id                        new value and/or description
DELETE /api/teams/:teamId/vault/:id
POST   /api/teams/:teamId/vault/:id/reveal                 audited, no-store
GET    /api/teams/:teamId/vault/:id/versions
POST   /api/teams/:teamId/vault/:id/rollback
POST   /api/teams/:teamId/vault/import                     one-time .env import
GET    /api/teams/:teamId/vault/activity                   the Vault part of the audit log

GET    /api/projects/:id/variables                         names and source, never values
POST   /api/projects/:id/variables                         { name, value } or { name, vaultName }
PATCH  /api/projects/:id/variables/:varId                  switch source, new value
DELETE /api/projects/:id/variables/:varId
POST   /api/projects/:id/variables/:varId/reveal           audited (a vault variable reveals
                                                           with the Vault permission, D3)

GET/POST/DELETE /api/teams/:teamId/vault/service-keys[/:id][/rotate]

/api/instance/vault/…                                      the same shape, instance admins only
```

Outside systems (service key in `Authorization: Bearer zvk_…`):

```
GET  /api/v1/vault/secrets                                 names (scope: list)
GET  /api/v1/vault/secrets/:name                           one value (scope: read)
GET  /api/v1/vault/secrets?names=A,B                       several values (scope: read)
PUT  /api/v1/vault/secrets/:name                           set a value (scope: write)
```

Rate-limited per key. A refused request says why (expired, revoked, name not allowed, IP not
allowed) without revealing whether a secret exists.

## 7. Screens

- **Sidebar:** a **Vault** entry next to Projects, Image Studio and Video Studio.
- **Vault page:** choose the team (or "Instance" for administrators), then three tabs:
  - **Secrets:** list (names, a Protected badge, which projects use each, who changed it and
    when, and **where it is used**), add, change, reveal, history and restore, import `.env`;
  - **Service keys:** create (with scopes, name patterns, IPs, expiry), the key shown
    once with copy-paste examples (curl, Node, Python), rotate, revoke, last used;
  - **Activity:** who revealed, changed or fetched what, and from where.
- **Inside a coding project:** the button becomes **Variables**: the list of what this app is
  given. Adding one asks for a name, then **Type a value** or **From Vault ▾**
  (D0). Values are never shown in the list.
- **Settings:** every credential field gets the same **Type a value / From Vault ▾** choice.

## 8. Phases

Each phase is **deployed to app.zelyq.com and tested by you before anything is pushed to
GitHub.** Nothing moves to the next phase without your OK.

| Phase | Delivers | You can test |
| --- | --- | --- |
| **1. Standalone team Vault + project variables** | Data rework and migration; team Vault API; Vault page in the sidebar (Secrets tab, "where used"); project Variables with **Type a value / From Vault**; the agent sees the variable names | Add `STRIPE_KEY` in Vault from the sidebar; in a Python project add a variable typed directly and another **From Vault**; the running app receives both |
| **2. Service keys + outside API** | Service keys tab; `/api/v1/vault`; Activity tab | Create a key, fetch a secret with `curl` from any machine, see the fetch in Activity, revoke it and see `curl` refused |
| **3. Delivery to Supabase functions** | The project's variables are pushed to the linked Supabase project as Edge Function secrets (Management API `POST /v1/projects/{ref}/secrets`, through the existing connection) whenever they change | In a React project linked to Supabase, an Edge Function reads its variable |
| **4. Instance Vault + Settings** | Instance Vault for administrators; every Settings credential field gets **Type a value / From Vault**; credentials in `.env` copied into Settings once and no longer read from there | Put an OpenAI key in the Instance Vault, choose it in Settings, the agent works with it |
| **5. `zelyq vault run`** | A small command that starts any program with its secrets, nothing written to disk | `zelyq vault run -- node server.js` on another machine |

**Where a secret can and cannot go.** Of Zelyq's three templates, only React + FastAPI runs
server code of its own. A plain React app runs in the visitor's browser and an Expo app on their
phone; anything given to them is public, so Vault never sends a secret there, and the agent is
told so. For those apps the server side is a Supabase Edge Function, which is what phase 3
covers.

Pipelines (`vault://NAME`) and Deploy use Vault as their own stages are built; the reference
format is fixed now so they need nothing new from Vault.

## 9. How each phase is checked before it reaches you

1. Automated tests for every rule in D3 and D6, including tests that fail when the rule is
   broken on purpose.
2. The full suite, lint, typecheck and build, as CI runs them.
3. Run on a separate local copy and walked through in a browser.
4. Deployed to app.zelyq.com (after a database backup), then a check there that it works.
5. You test. Only then: commit, push, pull request.

## 10. Open points for you

1. **Order:** phases 1 → 5 as listed.

Decided: one value per secret (D2); live keys are admin/owner only via **Protected** (D2b); a
reference needs no token (D0b); Vault is optional, every field can be typed or taken from Vault
(D0); credentials are never read from `.env` (D8).
