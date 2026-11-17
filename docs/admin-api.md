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
| `GET /plans` | `plans` | The plans, the plan new teams start on, and every plan including Unlimited |
| `PUT /plans` | `plans` | Replace the plans: `{ "plans": [{ "id", "name", "limits" }], "defaultPlan" }` |
| `GET /teams/:id/usage` | `usage` | What a team uses against its plan |
| `PUT /teams/:id/plan` | `teams` | Move a team to a plan: `{ "plan": "pro" }` |

More calls (people, teams, status, activity, health, events) are added in later versions of this
page.

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
  method, the call and the result. Request bodies are not logged.
