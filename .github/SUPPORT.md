# Getting help

**Something is broken** → [open an issue](https://github.com/CrowPus/Zelyq/issues/new/choose). The
bug template asks for the few things that make a report actionable: what you expected, what happened,
your runtime mode, and the server or agent output.

**A question, an idea, or "am I holding it wrong?"** →
[Discussions](https://github.com/CrowPus/Zelyq/discussions). Questions asked there stay searchable
for the next person, which is worth more than a private answer.

**A security vulnerability** → do not open an issue. Follow [SECURITY.md](../SECURITY.md), which
routes to a private advisory only you and the maintainers can see.

## Before you ask

Most reports come down to one of these, and each is quick to check:

- **The agent will not answer** — `GET /api/health` shows whether the agent is reachable and whether
  a model key is configured. The error the UI shows names the exact environment variable it looked
  for.
- **The preview never starts** — open the Logs panel. It is nearly always a dependency install
  failure or a syntax error in generated code.
- **Something changed in Settings had no effect** — a value supplied by the environment wins and is
  shown locked in the UI. Remove it from the environment to manage it in the app.

[docs/](../docs) covers configuration, architecture, self-hosting, and how the agent behaves.

## What to expect

Zelyq is pre-1.0 and maintained by a small team. Issues are read, triaged with `area:` labels, and
prioritised by how many people a problem blocks. A pull request that includes a test is the fastest
route to a fix being merged.
