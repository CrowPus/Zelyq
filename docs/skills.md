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

## Uploading one, without touching the filesystem

An instance administrator can add a skill from **Settings** — pick a
skill's folder, `SKILL.md` and all, and it's uploaded and validated the
same way a skill loaded from disk already is. See `043` in the council
notes. It still takes a restart of the agent to actually activate, the
same as a plugin change already does — uploading writes the files, it
doesn't reach into a process already running. Precedence, most manual
override last: an upload can replace a built-in skill's name, and
`ZELYQ_SKILLS_DIR` can replace either. There's no delete button for an
uploaded skill yet — remove its directory under `ZELYQ_SKILLS_UPLOAD_DIR`
by hand, the same as a built-in would need.

## Picking one from the composer, guaranteed

Typing `/` anywhere in the composer — not just at the start of the draft —
opens a menu of skills, plugins, and models, filtered as you keep typing.
Picking a skill there is a different promise from the catalog above: its
full body is woven directly into the message the model reads on turn one,
before the turn even starts, rather than left for the model to decide
whether `use_skill` is worth calling. It rides in the one message a model
cannot fail to read, the same reason attachments and a pointed preview
element already work this way. See `044` in the council notes.

## The trust model, stated plainly

A skill is text, not code. It cannot execute anything on its own — the
worst it can do is try to talk the agent into using a tool it already has
badly. That's a real, but categorically smaller, version of the question
[plugins.md](./plugins.md) already answers for actual code — which is
exactly why a skill can be uploaded through Settings while a plugin still
can't: uploading only ever requires being the instance admin, the same
person who could already reach the filesystem directly, and that gate
was always the real boundary, not "does this touch the UI." A plugin
staying off Settings is unrelated and unchanged — it is still arbitrary
code, a different and larger question.

## What ships today

Four skills are committed: two narrow and stack-specific —
`stripe-checkout` and `shadcn-ui-setup`, both for the template's actual
stack (React 19 + TypeScript + Vite + Tailwind) — and two broader,
senior-engineer-level bodies of practice, `senior-software-engineering`
(the general baseline for any meaningful change) and `cinematic-web`
(immersive, motion-heavy, 3D-flavored builds). `shadcn-ui-setup` carries
a `references/` file — a component-selection guide the agent only reads
when it's actually deciding which component fits a request — as the
working example of the deeper structure above.

Four more exist in an active working tree as this is written, not yet
committed: `frontend-ui-engineering` and `ui-ux-design-intelligence`
(engineering and design/product depth for interface work),
`application-security-engineering`, and `ci-cd-and-automation`. Once
committed, the library is eight skills, not four — the last two named
are written for ground broader than any one project here has on its
own (a request can still genuinely call for that shape of work: a CI
workflow file, a security pass over code that exists in the project),
which is why they belong in the catalog rather than being cut, but they
should not fire on the assumption that a frontend-only project has a
backend or a deploy pipeline it does not. See the decision guidance
`buildSkillsSection` puts in the system prompt itself
(`apps/agent/src/prompt.ts`) for how the model is told to pick among
several that could plausibly apply to the same request — that guidance
already accounts for all eight, committed or not, since it never names
a skill by hand.

The library grows the same way templates do: by adding files, not by
touching code. There's no per-project or per-team skill authoring from
the UI yet — a real, separate idea, not required to make this useful
today.
