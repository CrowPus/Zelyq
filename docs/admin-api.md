# Admin API

The admin API is how your own systems run a Zelyq server: an account service (see
[managed mode](configuration.md#managed-mode-an-outside-account-service)), monitoring, analytics
or support tools. It lives under `/api/admin/v1` and is versioned: a change that would break a
caller comes as `v2`, never silently in `v1`.

## Keys

A caller is a key, never a person's session.

- **Make one** in **Server settings → API keys** (the server's administrators only), or on the
  server itself before anyone has signed in:

  ```sh
  pnpm --filter @zelyq/server admin-key create --name "Account service" --scopes accounts,teams,plans,usage
  pnpm --filter @zelyq/server admin-key list
  pnpm --filter @zelyq/server admin-key revoke adk_…
  ```

  The command uses the server's own settings (`.env`, `DATABASE_URL`).
- The key (`zlq_admin_…`) is **shown once** and stored only as a hash. Keep it in a secret store.
- **Send it** as `Authorization: Bearer zlq_admin_…`. A session cookie is ignored on
  `/api/admin/v1`, so a signed-in browser can never be made to call it.
- **Revoke** a key and it stops at once. The list shows when each key was last used, and from where.
- Give each system **its own key with only the scopes it needs**:

| Scope | What it reaches |
| --- | --- |
| `accounts` | Create, change, sign out, suspend and delete people |
| `teams` | Create teams, change their plan and status, delete them |
| `plans` | Read and set the plans and their limits |
| `usage` | Read what each team uses, and when it was last active |
| `events` | Read what happened here (sign-ups, new teams, limits reached) |
| `analytics` | Product numbers: active people, funnel, retention, feature use |
| `health` | Check every part of the server |
| `errors` | Server errors and failed builds |
| `metrics` | Performance numbers for monitoring |
| `support` | A team's facts and logs, to help it |
| `notify` | Announcements and notifications to people |
| `features` | Turn features on or off for everyone, a plan, a team or a person |
| `audit` | The audit log |

A call outside the key's scopes is refused with `403`.

## Calls

| Call | Scope | What it does |
| --- | --- | --- |
| `GET /whoami` | — | This key's name and scopes, and whether the server is `self_hosted` or `managed` |

### People

| Call | Scope | What it does |
| --- | --- | --- |
| `POST /accounts` | `accounts` | **Make sure a person exists** (see below). `201` when made, `200` when they already were |
| `GET /accounts?email=` · `?externalId=` | `accounts` | Find a person by email, or by the service's id for them |
| `GET /accounts/:id` | `accounts` | One person: email, name, status, the service ids linked to them, their teams with role and plan |
| `PATCH /accounts/:id` | `accounts` | Change `email` and/or `name`. An email another account has is refused (`409`) |
| `POST /accounts/:id/sign-out` | `accounts` | End every session the person has on this server |
| `PUT /accounts/:id/status` | `accounts` | `{ "status": "suspended", "reason": "…" }` or `{ "status": "active" }`. Suspending ends their sessions; they cannot sign in again (password or single sign-on) until made active. Signing in with a password shows the reason; through the service, "this account is suspended" (the reason never goes in a link) |
| `DELETE /accounts/:id` | `accounts` | Delete the person. `?look=1` first: says which teams go with them (teams where they are the only member, with their apps) and which stay. Refused (`409`) when they are the last owner of a team that has other members |

`POST /accounts` takes:

```json
{
  "email": "ama@example.com",
  "name": "Ama",
  "externalId": "the service's id for the person (the sub it signs them in with)",
  "team": { "name": "Ama's studio", "plan": "free" }
}
```

- `externalId` is linked to the server's single sign-on issuer (`ZELYQ_OIDC_ISSUER`; or send
  `issuer`), so when the person later signs in through the service they arrive in this account.
  The same `externalId` again returns the same person.
- An account that already has the email (made on this server before) is **linked**, not duplicated.
- `team` makes their first team, on that plan (or the plan new teams start on). `"team": false`:
  no team. The answer has `account`, `team` and `created`.
- People made here have no password: they sign in only through the service.

The server's own administrators cannot be suspended or deleted through the API (`403`), and a
team's Ops engineer is never an account here.

### Teams, plans and usage

| Call | Scope | What it does |
| --- | --- | --- |
| `POST /teams` | `teams` | A new team: `{ "ownerId", "name", "plan" }` |
| `GET /teams` | `teams` | Every team, oldest first: plan, status, when a person last used it, members, owners, apps, storage. `?limit=` (1–500, default 100), `?cursor=` (the `nextCursor` of the page before), `?plan=`, `?status=`, `?inactiveSince=` (teams nobody used since that date) |
| `PUT /teams/:id/status` | `teams` | `{ "status": "paused" \| "read_only" \| "suspended" \| "active", "reason": "unused", "message": "shown to the team" }` (see below) |
| `DELETE /teams/:id` | `teams` | Delete the team, its apps and their files. Refused (`409`) while the team is active: pause, make read-only or suspend it first. `?look=1` first: its apps, members and storage |
| `GET /teams/:id` | `teams` | One team, with its members and their roles |
| `PUT /teams/:id/plan` | `teams` | Move a team to a plan: `{ "plan": "pro" }` |
| `GET /plans` | `plans` | The plans, the plan new teams start on, and every plan including Unlimited |
| `PUT /plans` | `plans` | Replace the plans: `{ "plans": [{ "id", "name", "limits" }], "defaultPlan" }` |
| `GET /teams/:id/usage` | `usage` | What a team uses against its plan |
| `GET /usage` | `usage` | Every team's use against its plan, with its status and last activity, paged and filtered like `GET /teams`: for a daily run |

### Team status

| Status | Still works | Stops | Lifted by |
| --- | --- | --- | --- |
| `active` | everything | — | — |
| `paused` (unused) | looking, downloading, deleting, *Free up space* | building, previews (stopped at once), pipeline runs (people's and scheduled), outside agents, anything new or changed | the team's owner or an admin, with **Resume** on the banner; or the API |
| `read_only` (e.g. cancelled, over its plan) | the same as paused | the same as paused | the API only |
| `suspended` (abuse) | nothing: members see why | everything, even looking | the API only |

Nothing is deleted by any status. Members see a banner with the message (or a plain default),
and *Resume* (paused), *Change plan* (read-only, managed) or *Contact …* (suspended, managed).
The server's own administrators are not held by a team's status.

**Last activity:** a team counts as used when a person does something in it (opens it, builds,
previews, runs a pipeline, an outside agent works), written at most every ten minutes. Work
nobody started (a schedule) does not count. A person's `lastSeenAt` is in `GET /accounts/:id`.

### Product activity (`analytics`)

What people do on this server is recorded where it happens, for this server's own administrators.
It never leaves the server by itself: only a key with the `analytics` scope can read it.

| Call | What it gives |
| --- | --- |
| `GET /product-events` | The raw events, oldest first: `?from=&to=` (dates or times; default the last 30 days, at most 800 days), `?name=`, `?team=`, `?user=`, `?limit=` (up to 2000), `?cursor=` (the `nextCursor` of the page before) |
| `GET /metrics/overview` | Per day: sign-ups, active people and teams, apps made, messages to the agent, builds (and how many failed), previews, deploys (and failed), pipeline runs, limits reached. Totals for the range, and the people and teams active in the last day, 7 days and 30 days |
| `GET /metrics/funnel` | Activation: of the teams that signed up in the range, how many made an app, had the agent build something, opened a preview, deployed, invited someone (at any time since), with the share at each step |
| `GET /metrics/retention?weeks=8` | Of the people who signed up in each of the last weeks, the share who did anything 1, 2, … weeks after signing up (`null` for a week not over yet) |
| `GET /metrics/features` | For each feature (Studio images and video, voice, Vault, pipelines, deploy environments, outside agents, Ops, git, Supabase, Figma): uses, teams, and uses by plan |
| `GET /metrics/plans` | Teams per plan, teams at 80% or more of a limit, and which limits stopped people, how often, in how many teams |

**The events:** `account.created`, `account.signed_in`, `team.created`, `member.invited`,
`member.joined`, `app.created`, `app.deleted`, `agent.message`, `agent.build_finished`,
`preview.started`, `preview.failed`, `pipeline.run_finished`, `deploy.finished`, `limit.reached`,
`feature.used`. Each has the time, the person, the team, the app when there is one, and a few short
facts: how someone signed in, the template, whether a build or deploy worked and how long it
took, which limit or feature. **Never** what anyone typed, code, files, names of secrets or keys:
anything else is dropped before it is stored.

**Keeping it:** one row per event is kept for 13 months (`ZELYQ_PRODUCT_EVENTS_MONTHS`); older
rows are folded into daily totals, which the overview still counts. `ZELYQ_PRODUCT_EVENTS=off`
records nothing.

### Health, errors and performance (`health`, `errors`, `metrics`)

| Call | Scope | What it gives |
| --- | --- | --- |
| `GET /health/deep` | `health` | Every part, checked now, each `ok`, `slow`, `down` or `off` with the reason: database (and how fast), disk space, the agent service, the container runtime, mail, the event loop, memory, the idle clean-up. Answers `503` when anything is down, so a monitor can alert on the status alone. (The public `/api/health` stays the short one.) |
| `GET /errors` | `errors` | Server errors, **grouped**: the same kind of failure in the same place is one group, whatever ids or numbers its message had. Each: kind, message, where in the code, the call it happened in, count, first and last seen, status, and how often and to how many people and teams in the range. `?from=&to=` (default the last 7 days), `?status=open\|resolved\|ignored`, `?limit=` |
| `GET /errors/:id` | `errors` | One group: an example stack, the last 30 days, and per day |
| `PATCH /errors/:id` | `errors` | `{ "status": "resolved" }` (or `ignored`, `open`). A resolved group that happens again opens again |
| `GET /failures/agent` | `errors` | Agent work that failed, by reason (`no_key`, `rate_limited`, `model_error`, `stopped`, …) and by AI provider, with the failure rate and how many teams were hit. Customers bring their own keys: a wave of `no_key` is a sign for better help text, not an outage |
| `GET /failures/builds` | `errors` | Failed previews (by reason), pipeline runs (by how they ended) and deploys |
| `GET /performance` | `metrics` | Each call's timing since the server started (typical, 95%, worst; slowest first), the event loop, memory, and how long agent work, preview starts and pipeline runs take |
| `GET /prometheus` | `metrics` | The same as a Prometheus feed (uptime, memory, event loop, calls and time per route): for Prometheus, Grafana or Google Cloud Monitoring, with the key as a bearer token |

**What counts as an error:** a call that broke on the server's side (a bug, a crash), and agent
work that broke on this server's side. A refusal (`403`, `404`, a plan limit) is an answer, not an
error. **Secrets are taken out** before anything is stored: keys (Anthropic, OpenAI, Gemini,
GitHub, Slack, Zelyq's own), tokens, passwords, `user:password@` in addresses, and email
addresses. Who was hit is kept 90 days; the groups and their totals stay.

More calls (events sent to your systems) come in later versions of this page.

## Rules every call follows

- **Answers** are JSON. Errors are `{ "error": { "code", "message" } }` with the usual status
  (`400` bad input, `401` no or bad key, `403` scope, `404` not found, `409` conflict,
  `429` too many calls).
- **Rate limit:** 600 calls a minute per key. Each key has its own allowance.
- **Retries are safe:** send an `Idempotency-Key` header (1–200 characters, e.g. a UUID) with any
  change. The same request again within a day gets the first answer, marked
  `idempotent-replayed: true`, and changes nothing twice. The same key with a different request is
  refused with `409`. Server failures (`5xx`) are not remembered, so a retry really retries.
- **Audit:** every change made with a key is in the audit log as *Admin key "name"*, with the
  method, the call, the result and who or which team it was about (a change to a team also shows
  in that team's own activity). It is written before the answer is sent. Request bodies are not
  logged.
