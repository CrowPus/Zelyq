# GitHub

Connect GitHub with a click instead of pasting a token. After a team connects its GitHub account
or organization, Zelyq can import repositories, push, open pull requests, create new repositories
and run pipelines on them, all without a personal access token.

It works one of two ways, set once per Zelyq server:

- **The GitHub sign-in app** (Zelyq Cloud). The same GitHub OAuth App people sign in with also
  asks, when someone presses **Connect GitHub**, for access to their repositories. Nothing extra
  to create. Access is all or nothing: Zelyq can use every repository that person can push to.
- **A GitHub App** (your own server). A server admin creates it once, in two clicks (below).
  People choose on GitHub which repositories Zelyq may reach.

Until one is set, everything keeps working with pasted or Vault tokens, as before.

## For a team

1. Open **Team settings → Integrations → GitHub** (team admins).
2. Press **Connect GitHub**. GitHub asks which account or organization, and which repositories
   Zelyq may reach. You can connect your own account and organizations you are an **owner** of;
   for any other organization, ask one of its owners to connect it.
3. You come back to Zelyq with the account listed. Connect more accounts with
   **Connect another account**.

What changes after that:

| Where | Before | With GitHub connected |
| --- | --- | --- |
| New app → Import from Git | Paste the address and a token | Pick the repository from a list |
| Git panel (push, pull, pull request) | A token for every action | No token needed |
| Git panel → connect a repository | Paste an address | Pick one, or create a new repository |
| Pipelines on a GitHub repository | `token: vault://…` and a webhook added by hand | Neither: checkout, push triggers and (with `report-status: true`) ✓/✗ statuses work by themselves |

A token you paste, or a pipeline's own `token:`, still wins over the app.

To give Zelyq more or fewer repositories later, press **Choose repositories** next to the
account; it opens the app's page on GitHub. **Disconnect** removes the link from this team only;
the app stays installed on GitHub until you uninstall it there.

Everyone in the team sees what is connected. Only team admins connect and disconnect. Editors use
the repositories.

## With the sign-in app (Zelyq Cloud)

When someone presses **Connect GitHub**, GitHub asks them to let Zelyq reach their repositories
(scopes `repo`, `workflow`, `admin:repo_hook`, `read:org`). After that:

- The repository picker lists every repository they can push to, their own and their
  organizations'.
- A **push trigger** on a GitHub repository gets its webhook put on the repository by Zelyq
  (when the server has a public `https://` address): there is nothing to copy.
- Missing an organization's repositories? Organizations can restrict outside apps. Open
  **Manage on GitHub** next to the account and request access for the organization; an owner
  approves it once.
- New repositories are created in the person's own account.
- **Disconnect** withdraws this token on GitHub as well. Signing in with GitHub is not affected.

Zelyq uses the connected person's access for the team's work, so connect an account whose
repositories the team should reach.

### Setting it up

Zelyq reads the sign-in app's keys from its environment:

| Variable | Value |
| --- | --- |
| `ZELYQ_GITHUB_OAUTH_CLIENT_ID` | The OAuth App's client ID |
| `ZELYQ_GITHUB_OAUTH_CLIENT_SECRET` | Its client secret |
| `ZELYQ_GITHUB_OAUTH_REDIRECT_URL` | Where GitHub sends people back. Default `<ZELYQ_PUBLIC_URL>/api/integrations/github/callback` |

GitHub only sends people back to an address under the OAuth App's **Authorization callback URL**.
On Zelyq Cloud that URL belongs to Zelyq Accounts (`https://accounts…/signin/github/callback`),
so Zelyq uses `https://accounts…/signin/github/callback/connect`, and Accounts passes the person
straight on to Zelyq. The cloud setup fills in all three from the Accounts keys
(`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`): nothing to change on GitHub.

When a GitHub App is also set, the GitHub App is used.

## For a server admin: create the app

1. Open **Server settings → Integrations → GitHub**.
2. Optionally enter a GitHub organization to own the app. Leave it empty to create it on your own
   account.
3. Leave **Any GitHub account may connect it** on if teams will connect accounts other than yours.
   Turn it off to keep the app to its owner only.
4. Press **Create GitHub App**. GitHub opens with everything filled in. Press **Create** there.
5. GitHub sends the app's keys straight back to Zelyq, which stores them encrypted. Done.

**Remove from this server** forgets the app here. Teams' connections stop working until a new app
is created. The app itself stays on GitHub, where you can delete it.

### Webhooks need a public address

GitHub tells Zelyq about pushes and pull requests only when it can reach the server: set
`ZELYQ_PUBLIC_URL` to an `https://` address that is reachable from the internet **before** you
create the app. On a private address the app is created with webhooks off. Everything else still
works; a pipeline's push trigger can still use its own webhook (Pipelines → Triggers).

## For an operator: set it through the environment

Zelyq Cloud and managed servers give the app through the environment instead. When these are set,
Server settings shows the app read-only and the settings-stored app is ignored.

| Variable | Value |
| --- | --- |
| `ZELYQ_GITHUB_APP_ID` | The app's numeric ID |
| `ZELYQ_GITHUB_APP_SLUG` | The app's URL name (`github.com/apps/<slug>`) |
| `ZELYQ_GITHUB_APP_CLIENT_ID` | Client ID (`Iv…`) |
| `ZELYQ_GITHUB_APP_CLIENT_SECRET` | A client secret |
| `ZELYQ_GITHUB_APP_PRIVATE_KEY` | The `.pem` private key. Line breaks may be written as `\n`. |
| `ZELYQ_GITHUB_APP_WEBHOOK_SECRET` | The webhook secret. Leave empty with webhooks off. |

Register the app by hand (GitHub → Settings → Developer settings → GitHub Apps → New) with:

- **Callback URL**: `<ZELYQ_PUBLIC_URL>/api/integrations/github/callback`, and
  **Request user authorization (OAuth) during installation** on.
- **Webhook URL**: `<ZELYQ_PUBLIC_URL>/api/integrations/github/webhook`, with a secret.
- **Repository permissions**: Contents, Pull requests, Commit statuses, Workflows and
  Administration: read and write. Metadata: read.
- **Organization permissions**: Members: read (to check that the person connecting an
  organization is one of its owners).
- **Events**: Push, Pull request.
- **Where can this app be installed**: Any account.

## How it is kept safe

- **With the sign-in app**, the person's GitHub token is stored sealed with the server's
  encryption key, used only for this team's git commands and GitHub calls (git hooks switched
  off), never shown in the browser or a log, and never given to the agent or written into a
  project. The return from GitHub must carry the one-time `state` Zelyq made for that person.
- **No stored repository tokens (GitHub App).** For git, Zelyq signs a short request with the app's key and
  GitHub returns a token that lasts one hour, reaches **one repository**, and cannot change the
  repository's settings. It is passed to the one git command (with git hooks switched off) and
  is never written into the project, shown in the browser or a log, or given to the agent.
  Listing repositories and creating one in an organization use a token that stays on the server.
- **Only what you own.** When someone connects, Zelyq asks GitHub which installations that person
  can see and links only their own account and organizations where they are an owner. Being able
  to read one repository of an organization is not enough. An installation number in the address
  is never trusted, and the round trip carries a one-time `state` tied to the person who started it.
- **Encrypted at rest.** The app's keys (when created in Server settings) and each connection are
  sealed with the server's encryption key.
- **Signed webhooks.** A webhook is accepted only with GitHub's signature made with the app's
  secret, and starts pipelines only in teams that connected that installation.
- **Personal accounts.** To create a repository in a personal account, GitHub requires the
  person's own authorization; Zelyq keeps that sealed, refreshes it, and uses it for nothing else.

The app asks for **Administration** only so it can create a repository. Repository tokens never
carry it. If you register the app by hand and leave it out, everything except **New repository**
in an organization keeps working.
