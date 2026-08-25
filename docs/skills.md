# Skills

A skill is packaged, expert instructions for one specific kind of task —
loaded into a turn only when it's actually relevant, not carried by every
turn regardless. The agent's [system prompt](../apps/agent/src/prompt.ts)
is one fixed set of instructions for every project; a skill is depth on
top of that, for a task that genuinely needs it.

## A skill is a directory, not a file

`SKILL.md` is the entry point — kept short, the way a good README is —
and everything a task might actually need beyond that lives underneath
it, loaded only when the agent asks for that one file by path:

```
skills/
└── shadcn-ui-setup/
    ├── SKILL.md
    └── references/
        └── available-components.md
```

`references/`, `recipes/`, `templates/`, `scripts/` — whatever
subdirectory names make sense for a given skill — are an authoring
convention, not something Zelyq enforces. The agent reaches every file
under a skill's directory the same one way, so organize it however makes
the skill easiest to write and read.

## How it works

Every loaded skill's name and one-line description sit in the system
prompt, cheaply, all the time — the same way the list of available tools
already does. When a task matches, the agent calls `use_skill` with just
the name, and gets back `SKILL.md`'s own body plus a list of every other
file the skill has. If one of those looks relevant — a deeper reference,
a worked recipe, a starting template — it calls `use_skill` again with
that path, and gets that file's actual content. Two-tier, the same
mechanism Claude's own Agent Skills already use: a cheap catalog always
present, the expensive part loaded only on request, and loaded again,
one file at a time, only as deep as a task actually needs to go.

A skill's `templates/` files are read the same way any other resource is
— the agent then places them in the project with its own `write_file`,
same as anything else it writes. A `scripts/` file's source is read the
same way too; the agent can adapt it into a real command run through
`run_command` inside the project's own sandbox. Nothing here executes a
file from outside the project on the agent's behalf — a project's
container cannot even see this directory, and bridging that gap would be
a real, separate trust decision, not an extension of what a skill safely
is today. Text only, for now: a skill that wants to carry a binary asset
(an image, a 3D model) is a genuine, separate step once there's real
usage to learn from.

## Writing one

Create a directory under `skills/` (or wherever `ZELYQ_SKILLS_DIR`
points) named for the skill, with a `SKILL.md` inside: YAML frontmatter
with `name` and `description`, then the entry-point instructions.

```md
---
name: my-skill
description: One line — what this teaches, and when the agent should reach for it.
---

Whatever a person who's actually good at this would tell someone about to
attempt it, kept to what's actually needed to get started. Point to
`references/the-detail.md` by name for anything that would make this
file long — the agent only pays for that file's tokens if it actually
asks for it.
```

`name` must be lowercase letters, digits, and hyphens, starting with a
letter — it's how the agent refers to the skill and how it names a path
underneath it. `description` is the only part that's *always* in
context, for every session, whether the skill is ever used or not —
write it the same way you'd write a tool's description: what this is
for, and when to use it, in one line a model can act on.

Set `ZELYQ_SKILLS_DIR` to a local directory (see
[configuration.md](./configuration.md)) and every top-level subdirectory
in it containing a `SKILL.md` is read once at boot — not re-scanned while
running. A skill here with the same `name` as one of the ones that ship
in the box (`skills/` at the repository root) replaces it outright —
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

Two skills, `stripe-checkout` and `shadcn-ui-setup`, both for the
template's actual stack (React 19 + TypeScript + Vite + Tailwind), both
real enough to watch work. `shadcn-ui-setup` carries a `references/`
file — a component-selection guide the agent only reads when it's
actually deciding which component fits a request — as the working
example of the deeper structure above. The library grows the same way
templates do: by adding files, not by touching code. There's no per-
project or per-team skill authoring from the UI yet — a real, separate
idea, not required to make this useful today.
