# Skills

A skill is packaged, expert instructions for one specific kind of task —
loaded into a turn only when it's actually relevant, not carried by every
turn regardless. The agent's [system prompt](../apps/agent/src/prompt.ts)
is one fixed set of instructions for every project; a skill is depth on
top of that, for a task that genuinely needs it.

## How it works

Every loaded skill's name and one-line description sit in the system
prompt, cheaply, all the time — the same way the list of available tools
already does. The full instructions only load when the agent decides a
task actually matches one, by calling `use_skill` with the skill's name.
That two-tier shape — a cheap catalog always present, the expensive part
loaded on request — isn't a novel idea invented for Zelyq. It's the same
mechanism Claude's own Agent Skills already use.

## Writing one

A skill is one Markdown file: YAML frontmatter with `name` and
`description`, then the instructions themselves.

```md
---
name: my-skill
description: One line — what this teaches, and when the agent should reach for it.
---

Whatever a person who's actually good at this would tell someone about to
attempt it. Concrete steps, the mistakes that are easy to make, what the
finished thing should and shouldn't include.
```

`name` must be lowercase letters, digits, and hyphens, starting with a
letter — it's how the agent refers to the skill when calling `use_skill`.
`description` is the only part that's *always* in context, for every
session, whether the skill is ever used or not — write it the same way
you'd write a tool's description: what this is for, and when to use it,
in one line a model can act on.

Set `ZELYQ_SKILLS_DIR` to a local directory (see
[configuration.md](./configuration.md)) and every top-level `.md` file in
it is read once at boot — not subdirectories, not anything re-scanned
while running. A skill here with the same `name` as one of the two that
ship in the box (`skills/` at the repository root) replaces it outright —
that's the expected way to swap in your own house version of a built-in.

## The trust model, stated plainly

A skill is text, not code. It cannot execute anything on its own — the
worst it can do is try to talk the agent into using a tool it already has
badly. That's a real, but categorically smaller, version of the question
[plugins.md](./plugins.md) already answers for actual code: still an
operator-trust decision, which is why loading one still requires
filesystem access to the machine Zelyq runs on and a restart, and still
isn't reachable from Settings or a project's own repository — just a
lower ceiling of what goes wrong if the trust is misplaced.

## What ships today

Two skills, `stripe-checkout` and `shadcn-ui-setup` — both for the
template's actual stack (React 19 + TypeScript + Vite + Tailwind), both
real enough to watch work, not padding. The library grows the same way
templates do: by adding files, not by touching code. There's no per-
project or per-team skill authoring from the UI yet — a real, separate
idea, not required to make this useful today.
