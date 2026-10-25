# Agents

Let an outside AI agent — Claude Code, Cursor, VS Code, Gemini CLI, ChatGPT, anything that speaks
MCP — work inside Zelyq. The agent thinks with its own model and subscription; Zelyq lends it hands
on the apps, pipelines, environments and Studio you give it, and nothing else. Zelyq's own model
keys are never spent.

## Create an agent

**Agents** (under Build) → **New agent**. Only a team's admins and owners manage agents: an agent's
key can change every app it is given.

- **Name and job.** The job is the first thing the agent reads (`my_job`).
- **Apps, pipelines and environments** it may touch: the ones you tick, or every one. Pipelines it
  creates are always its own. A pipeline it writes may only build one of its apps and deploy only to
  one of its environments.
- **What it may do**, per permission: Off, Allowed or Needs approval.

| Permission | Levels | What it covers |
| --- | --- | --- |
| Read code / Write code | Off, Allowed | Files of its apps; an undo point is taken before it changes an app |
| Run commands, Preview, Commit | Off, Allowed | Install, test, build; the live preview and screenshots; the app's own git |
| Push | Off, Needs approval | Pushing to the app's remote |
| Write pipelines | Off, Needs approval, Allowed | Create, edit, delete, restore pipelines; with approval you see the diff first |
| Run pipelines | Off, Needs approval | Runs and re-runs, deploys included |
| Deployments | Off, Needs approval | See environments and apps; restart, stop, start, roll back, promote |
| Generate images / video | Off, Allowed / Off, Needs approval | Studio, on the agent's own provider key |
| Bring its own media | Off, Allowed | Images and videos it made itself, by link or file |
| Vault names | Off, Allowed | Which secrets an app gets — never their values |

The key (`zlq_agent_…`) is shown once. Replace or revoke it at any time.

## Connect it

The gateway is `https://<your Zelyq>/agent-gateway/mcp`, with the key as a bearer token. The page
shows the exact setup for each client; for Claude Code:

```sh
claude mcp add --transport http zelyq https://<your Zelyq>/agent-gateway/mcp \
  --header "Authorization: Bearer zlq_agent_…"
```

Then ask the agent to call `my_job`.

### Claude.ai and ChatGPT connectors

Connectors cannot send a key in a header; they sign in with OAuth instead. Add a custom connector
with the gateway address and leave the OAuth client ID empty — the connector registers itself. It
then opens Zelyq's sign-in page: paste the agent's key there once. The connector acts as exactly that
agent, with its apps, permissions and approvals.

- Access tokens last an hour and the connector renews them for up to 30 days; each renewal token
  works once. Sign-in requires PKCE, and return addresses must be https.
- Replacing or revoking the agent's key ends every connector sign-in made with it. **Sign out
  connectors**, on the agent's row, ends them and leaves the key working.
- Discovery is at `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server`; the gateway's 401 points to the first. Behind a proxy,
  set `ZELYQ_PUBLIC_URL` (or `ZELYQ_TRUST_PROXY=true`) so the addresses are your public https ones.

## Approvals

Anything set to Needs approval becomes a request, approved where it is used: pipeline changes and runs
in **Pipelines**, deployment changes in **Deployments**, videos in **Video Studio**. The Agents page
links to what is waiting. An approved request is carried out as the person who approved it, with
their permissions; for a pipeline change, it fails rather than apply if the pipeline changed since
the agent asked.

For pipelines and deployments the agent otherwise works on behalf of the admin who created it: it
never has more than that person, and loses what they lose. It may not change a pipeline with
triggers switched on — those run without approval — so a person changes those.

## Studio on the agent's own key

In the agent's settings, **Who pays for its images and video**: a provider and the Vault secret
holding its key. The agent never sees the key, and with none set it has no generation tools.

- `generate_image` makes an image in Studio (optionally also into an app), and `studio_import_image`
  brings in a person's portrait or a logo to use as a reference.
- `request_video` asks for a video, from text or by animating one of its images; Studio makes one
  video at a time per person.
- What it makes appears in Studio for the person who created the agent. The agent sees only its own.

A provider may decline content — Google will not animate real people's likenesses. Its reason is
shown as given.

## Pipeline history

Every save of every pipeline — by a person, an agent, a restore or the repository — is kept. A
pipeline's **History** tab shows each version as a diff and puts an earlier one back (as a new
version, so a restore can be undone too).
