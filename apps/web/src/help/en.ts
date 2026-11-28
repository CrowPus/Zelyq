import type { Articles } from "./articles";

export const articles: Articles = {
  start: {
    title: "Getting around Zelyq",
    body: `Zelyq is organised by **team**. Everything a team makes (its apps, pipelines, environments and secrets) belongs to it, and everyone in the team can see it.

- **Sidebar.** On the left: **Home**, then **Build** (Apps, Studio, Agents), **Ship** (Pipelines, Deployments, Ops) and **Secure** (Vault). Inside an app, the sidebar lists that app's own sections instead.
- **Top bar.** The team switcher and the breadcrumb show where you are. Search (**Ctrl K** or **⌘ K**) finds any app, pipeline or environment, and takes you to any page, Vault and settings included.
- **Inbox.** The bell collects what is waiting for you, such as a deploy or an agent's request to approve.
- **Help.** The **?** menu opens these articles, the keyboard shortcuts and the full beginner's guide.

**Home** shows what needs attention first: anything failing or waiting on you, then your recent apps and runs.

Switch teams from the team name at the top left. Your own account, language and security are under your picture at the top right.`,
  },
  apps: {
    title: "Apps",
    body: `An **app** is a project the agent builds with you: a website, a web app, an API or a mobile app. Each one has its own files, its own preview and its own history.

**Create one** with **New app**. Pick a starting point (a **stack**, such as React + Vite or FastAPI), give it a name, and describe what you want.

**Find one** with the search box (press **/** to jump to it), or filter by status and stack. Switch between cards and a list with the buttons on the right; the list can be sorted by any column.

**Open an app** to keep building it. Its **Overview** shows its preview, where it is live and its details; **Settings** holds its name and what the agent may do.

Apps belong to the team: everyone in it can open them. What each person may change depends on their role (see **Members and roles**).`,
  },
  build: {
    title: "Building with the agent",
    body: `This is where an app is made. On the left you talk to the agent; on the right you see the result.

- **Chat.** Describe what you want in plain words. The agent works in a real workspace: every change is a file you can read in **Code**.
- **Preview.** A private copy of the app, running here. Use the inspector to point at something and ask for a change to exactly that.
- **Modes.** The buttons under the message box turn on **Architect** (plans a whole project first), **Engineer** (careful, checked changes) and **Auto** (keeps going until the work is done).
- **/ menu.** Type **/** for commands such as **/clone** and **/figma**, specialist agents (Designer, DevOps, Security/QA), skills and models.

**Undo.** **Snapshots** keeps a restore point before each change, so you can go back to any earlier version.

**Variables** holds the app's settings and keys; a value can come from Vault so it is kept in one place. **Git** commits and pushes the app's code to a repository you connect.

When it works, press **Deploy** to put it online, or set up a pipeline that tests and deploys it on every change.`,
  },
  "app-settings": {
    title: "An app's overview and settings",
    body: `**Overview** is the app at a glance: its live preview, the environments it runs in and their addresses, and details such as its stack, ID and when it last changed.

**Settings** is where the app itself is changed:

- **App name.** Shown in the app list, the breadcrumb and the browser tab.
- **What the agent may do.** Generating images and generating video each spend money against the team's AI keys, so both start off. Switch them on here.
- **Danger zone.** Deleting an app removes its files, its preview and its history.

What each person may change depends on their role in the team.`,
  },
  pipelines: {
    title: "Pipelines",
    body: `A **pipeline** tests, builds and deploys an app, the same way every time. It is a file of **stages** that run in order; each stage has **steps** (commands, a checkout, a cache, a deploy).

**Create one** with **New pipeline** and a template. Edit it in **Visual** (click boxes and fields) or **YAML** (the file itself); both show the same pipeline.

- **Runs on.** \`local\` runs it on the Zelyq server, in a container thrown away afterwards. A **runner** is one of your own machines, added under **Runners** and reached over SSH.
- **Source.** Where the files come from: an app in Zelyq, a GitHub repository, or a folder on a machine.
- **Secrets.** Never write a key into the file. Use \`vault://NAME\` and Zelyq fills it in; secrets are masked in every log.
- **Triggers.** Run it by hand, on a schedule, or on every push and pull request from GitHub.

Each pipeline keeps its versions, so an earlier file can be restored. **Plugins** add ready-made steps.`,
  },
  runs: {
    title: "Reading a pipeline run",
    body: `A run is one go of a pipeline. The diagram shows each **stage** as a box, joined in the order they run; stages side by side run at the same time.

- **Colours.** Green passed, red failed, blue is running, grey is waiting or skipped.
- **Steps and output.** Click a stage to see its steps. Click a step to read what it printed. If a step failed, the last lines of its output usually say why.
- **Waiting for approval.** A deploy to a protected environment stops until an admin presses **Approve**. It also appears in the Inbox.

**Run again** runs the same file once more. **Cancel** stops a run that is still going; anything it already deployed stays as it was.

A run records who or what started it (a person, a schedule, a push) and how long each stage took.`,
  },
  deployments: {
    title: "Deployments and environments",
    body: `An **environment** is a place an app runs: \`staging\` or \`production\`, on one of your machines. **Deployments** lists each environment with the apps live in it, which version, since when and who put it there.

- **Deploy.** A pipeline's deploy step, or the **Deploy** button in an app, starts the app in Docker on the machine, checks that it answers, and keeps the previous version if it does not.
- **Logs and controls.** On an app's card, **Logs · manage** shows its live output with its CPU and memory, and **Restart** and **Stop**.
- **Roll back.** **History** lists every deploy; **Roll back to this** brings an earlier one back in seconds.
- **Protected.** Every deploy to a protected environment waits for an admin's approval. **Freeze** stops all deploys during a release.
- **Addresses.** Give an app a domain and Zelyq gets it a free HTTPS certificate.

**Variables** on an environment are given to every app in it, and can come from Vault.`,
  },
  vault: {
    title: "Vault",
    body: `**Vault** keeps the team's keys and passwords once, encrypted, so they can be used anywhere without being copied: in an app's Variables, in settings, in pipelines (\`vault://NAME\`) or from your own servers.

- **Add a secret** with a name such as \`STRIPE_KEY_LIVE\`, its value and a note on what it is for. **Import .env** adds many at once.
- **The table** shows every secret, where it is used, when it last changed and by whom. Once there are more than five, search it or show only the protected or unused ones.
- **Show or copy a value** from the row's menu. You are asked first, and it is recorded in **Activity** under your name.
- **Change value** saves a new version; **History** lists every version and can restore an earlier one. Everything using the secret gets the new value.
- **Protected** secrets can be shown, changed or used only by admins and owners. Use it for live keys.

**Service keys** let a server outside Zelyq read the secrets it is allowed to, and nothing else.`,
  },
  members: {
    title: "Members and roles",
    body: `Everyone in a team sees every app in it. Their **role** decides what they may change:

- **Viewer** reads apps, their files and conversations, and changes nothing.
- **Editor** also builds, edits and runs previews.
- **Admin** also manages members, agents and the team's settings, and deletes apps.
- **Owner** has full control, including the team itself.

**Add someone** by email. A person who already has an account joins straight away; anyone else gets an invitation that works for 7 days, when email is set up on this server. **Waiting to join** lists invitations not yet used.

**The table** can be sorted, and searched once the team has more than five people. **Last active** shows when each person last used Zelyq. Admins change a role in place; the row menu removes someone, or lets you leave.

**Who changed what** lists every change to the team: who was added or removed, which role changed and by whom.`,
  },
  agents: {
    title: "Outside agents",
    body: `An **agent** lets an outside AI tool (Claude Code, Cursor, VS Code, Gemini CLI or anything that speaks MCP) work inside Zelyq, with its own model and subscription. Zelyq gives it hands on the apps, pipelines and environments you choose, and nothing else.

**Create one** with **New agent**: give it a name and a job (the first thing it reads), tick what it may touch, and set each permission to **Off**, **Allowed** or **Needs approval**.

- Reading and writing code takes an undo point first, so its work can be rolled back.
- Pushing, running pipelines and changing deployments are always requests a person approves, in the Inbox.
- It sees which secrets an app gets, never their values.

The key is shown once. Copy the setup for your tool from the page, and replace or revoke the key at any time. Only admins and owners manage agents.`,
  },
  ops: {
    title: "Ops, your DevOps engineer",
    body: `**Ops** looks after the team's machines, environments and apps. Talk to it like a colleague: ask why something is slow, what changed, or to fix it.

- **Talk.** Type, or press the microphone and speak; it answers aloud.
- **Plans.** Ops looks freely, but every change is a plan of exact steps. **Approve** lets it do those steps and nothing else; **Reject** with a reason, and it remembers.
- **Status.** Checked every minute by Zelyq itself, with no AI and no cost.
- **Alerts.** What went wrong, when, and what Ops did about it.
- **Memory.** Rules it reads before every job, such as "never deploy on Friday afternoon". A person's word beats its own conclusions.
- **Access.** Which machines and environments it may reach, and how far it is trusted on each.

**Settings** holds its monthly spending limit, and **Pause Ops** stops everything it is doing at once.`,
  },
  studio: {
    title: "Studio",
    body: `**Studio** makes images and videos for your apps.

- **Image.** Describe the picture, choose a model and a size, and add reference images if the model takes them. Each result is kept in the image history.
- **Video.** Describe a scene, or animate an image from its starting frame. A clip takes a few minutes, and costs far more than a picture.
- **Use it.** Download a result, or pick it from Studio while building an app.

Studio uses the team's own image and video keys, set in **Team settings**. If no model is offered, an admin adds a key first.`,
  },
  "team-settings": {
    title: "Team settings",
    body: `Everything a team decides for itself, grouped in the menu on the left. Admins and owners change them.

- **Usage and plan.** What the team uses: apps, storage, builds, and how close it is to its limits.
- **AI keys.** The team's own keys for the models that build apps, Studio and voice. A key can come from the team's Vault.
- **Building apps.** Which model the agent uses and how hard it thinks.
- **Image Studio, Video Studio, Voice input.** The models and options for each.
- **Ops.** Whether the team's DevOps engineer is on, and its limits.
- **Email.** The team's own mail server, for the email Zelyq sends on its behalf.
- **Integrations.** GitHub, Figma, Supabase and others.
- **Support access.** Let Zelyq's support look at the team for 48 hours; every look is recorded.

A change takes effect for the whole team as soon as it is saved.`,
  },
  account: {
    title: "Your account",
    body: `Your account is yours across every team you are in.

- **Profile.** Your name and the email you sign in with. **Delete account** removes it for good.
- **Security.** Change your password (every other device is signed out). Turn on **two-factor sign-in** with an authenticator app, and keep the recovery codes somewhere safe. **Signed-in devices** lists every browser using your account; sign any of them out.
- **Preferences.** Your language (English, French, German, Spanish, Portuguese or Chinese), time zone, and how dates and numbers are written. Every device you sign in on follows them.

The theme (light, dark or matching your system) is in the menu under your picture.`,
  },
  admin: {
    title: "Server administration",
    body: `Server admin is for the people who run this Zelyq server. It changes things for every team.

- **Models and AI.** Which vendor the agent talks to, image and video generation, voice input, and the model Ops thinks with.
- **Runtime and preview.** Where app commands run, how previews are reached, and pipeline defaults.
- **Identity and access.** Who may sign in and for how long, the accounts on this server, and admin API keys.
- **Communication.** The mail server Zelyq sends through, and integrations.
- **Plans.** What each team may use.
- **Instance status.** The health of the server and its parts.

Each team can still choose its own keys and models in its **Team settings**; the server's are the default.`,
  },
};
