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
| `GET /teams` | `teams` | Every team, oldest first: plan, members, owners, apps, storage. `?limit=` (1–500, default 100), `?cursor=` (the `nextCursor` of the page before), `?plan=` |
| `GET /teams/:id` | `teams` | One team, with its members and their roles |
| `PUT /teams/:id/plan` | `teams` | Move a team to a plan: `{ "plan": "pro" }` |
| `GET /plans` | `plans` | The plans, the plan new teams start on, and every plan including Unlimited |
| `PUT /plans` | `plans` | Replace the plans: `{ "plans": [{ "id", "name", "limits" }], "defaultPlan" }` |
| `GET /teams/:id/usage` | `usage` | What a team uses against its plan |
| `GET /usage` | `usage` | Every team's use against its plan, paged like `GET /teams`: for a daily run |

More calls (team status, last activity, health, events) come in later versions of this page.

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
