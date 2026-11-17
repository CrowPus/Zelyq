# Running Zelyq for other people: managed mode

Zelyq is one codebase in two modes:

- **Self-hosted** (the default): the server has its own sign-up and sign-in, and every team is
  Unlimited unless its administrator makes plans.
- **Managed**: the server is connected to an **account service** you run (a hosted offering, or a
  company's own portal). The service owns sign-up, sign-in, profile and billing; Zelyq does the
  building and enforces what the service decides.

Nothing about managed mode is specific to one company: this page is the whole contract, so anyone
can build their own service.

## The three connections

| Connection | Direction | What for | Set up with |
| --- | --- | --- | --- |
| Single sign-on (OIDC) | person → service → Zelyq | One login: people sign in at the service and arrive in Zelyq | `ZELYQ_OIDC_*` ([configuration](configuration.md#single-sign-on-oidc)) |
| The admin API | service → Zelyq | Make people and teams, set plans and status, read usage and numbers, talk to people | A key from **Server settings → API keys** ([admin API](admin-api.md)) |
| Events | Zelyq → service | Be told what happened (sign-ups, members, limits, errors, health) | `ZELYQ_EVENTS_URL` + `ZELYQ_EVENTS_SECRET` ([events](admin-api.md#events-events)) |

and one setting that switches the screens: `ZELYQ_ACCOUNTS_URL` (+ `ZELYQ_ACCOUNTS_NAME`).

## Setting a server up

1. Start Zelyq. There is no set-up form: a managed server is run from the admin.
2. Make the service's key on the server: `pnpm --filter @zelyq/server admin-key create --name "Account service" --scopes accounts,teams,plans,usage,events`
   Keep it in the service's secret store. Make the admin's key the same way, with every scope (`--scopes all`).
3. Register Zelyq with the service as an OIDC client (callback
   `https://<zelyq>/api/auth/oidc/callback`), and set `ZELYQ_OIDC_ISSUER`, `ZELYQ_OIDC_CLIENT_ID`,
   `ZELYQ_OIDC_CLIENT_SECRET`, `ZELYQ_OIDC_REDIRECT_URI`.
4. Set `ZELYQ_ACCOUNTS_URL` and `ZELYQ_ACCOUNTS_NAME`, and, for events, `ZELYQ_EVENTS_URL` and
   `ZELYQ_EVENTS_SECRET`. Restart.
5. Push the plans: `PUT /api/admin/v1/plans`.

## What the service does, step by step

**Someone signs up.** The service makes their account, then calls `POST /accounts` with their email,
name, the service's own id for them (`externalId`, the `sub` it signs them in with) and their first
team on the starting plan. It sends them to Zelyq; they arrive signed in, in that account.

**They pay.** The service moves their team: `PUT /teams/:id/plan`. Zelyq enforces the plan's limits;
when one stops someone, the team's owner sees **Upgrade**, which opens the service's
`/upgrade?team=…&limit=…` page, and the service gets a `team.limit_reached` event.

**Every day.** `GET /teams?inactiveSince=<date>&plan=free` finds unused free teams;
`PUT /teams/:id/status` pauses them (the owner resumes with one click), and later
`DELETE /teams/:id` removes them. After a cancellation, `read_only`. For abuse, `suspended`, and
`PUT /accounts/:id/status` for the person.

**A person changes their email, or leaves.** `PATCH /accounts/:id`; `DELETE /accounts/:id` (with
`?look=1` first to see which teams go with them).

**Running the product.** Separate keys for analytics (`analytics`: sign-ups, active people, the
funnel, retention, feature use), developers (`health`, `errors`, `metrics`, and a Prometheus feed),
support (`support`: a team's facts and logs; inside its apps only with its permission), and the
product team (`notify` for announcements, messages and maintenance; `features` to switch features
on and off).

## The service's pages

Zelyq links to these paths on `ZELYQ_ACCOUNTS_URL`; the service provides them:

| Path | Zelyq sends people there to |
| --- | --- |
| `/signup?return_to=<url>` | create an account, then come back |
| `/account` | change their name, email or password, or delete their account |
| `/billing?team=<team id>` | change a team's plan (the team's owner) |
| `/upgrade?team=<team id>&limit=<limit>` | choose a bigger plan after a limit stopped them |
| `/signout?return_to=<url>` | sign out of the service too |

## What people see in managed mode

- Signing in goes straight to the service, and back to the page they were going to.
- **Account** shows their name and email, with a link to the service for everything else.
- A team's **Usage and plan** shows the plan, with **Change plan** for its owner.
- A paused, read-only or suspended team shows a banner saying why, and what to do.
- Announcements and maintenance from the operators appear as banners; messages in the bell.

## What each team brings

On a managed server the operator need not provide email or outside accounts: each team sets
its own in **Team settings**.

- **Email:** the team's own mail server (address, port, security, username, password, sender).
  Its invitations and Ops's messages go out through it. All or nothing: a team's email never
  borrows any detail of the server's (the server's password never goes to a team's server), and
  its address may not be this server, a private network or a cloud metadata address. Without one,
  an invitation gives a link to copy. Admin API: none (the team's own).
- **Integrations:** Figma is each person's own account. Supabase is the team's: its admins connect
  the team's Supabase account, and only the team's apps can link to its databases. A team never
  sees, uses or links another team's connection. The server's own Supabase connection (Server
  settings) is usable by every team only when self-hosted.
- The **Connect** buttons for Figma and Supabase need Zelyq registered once as an OAuth app with
  each (`ZELYQ_FIGMA_CLIENT_ID`/`_SECRET`, `ZELYQ_SUPABASE_OAUTH_CLIENT_ID`/`_SECRET`); without
  that, a team can still paste a Supabase access token.

## Run from the admin, locked here

A managed server has no password sign-in by default (`ZELYQ_LOCAL_SIGNIN` is off), and nothing
server-wide changes from inside it: server settings, plans, admin keys and the server Vault are
read-only for every session, even a server administrator's. They change only through the admin API
(`settings`, `plans` and the rest), from the admin, behind its own sign-in. A guessed password here
opens nothing. Keys are made on the server: `pnpm --filter @zelyq/server admin-key create`.

## What stays private

Data stays on the server that made it: nothing is sent anywhere unless a receiver is set or a key is
given. Product activity never holds what anyone typed, code, files or secrets; server errors are
stored with keys, tokens, passwords and emails taken out; and support cannot look inside a team's
apps without the team's own permission, with every look shown to the team.
