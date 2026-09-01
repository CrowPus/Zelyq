# Solution — the starting point

Addresses findings **G1–G3**.

Every web project this product builds starts from `templates/vite-react`. Four files decide what the
agent is looking at on turn one: `src/App.tsx`, `src/index.css`, `package.json`, `index.html`.

That scaffold is currently working **against** the system prompt. The prompt spends its longest
quality paragraph telling the agent not to produce a particular look, and the template hands it that
exact look as the thing to edit. This is the cheapest quality lever in the whole review: four small
files, no agent logic, no API change.

---

## 1. The template is the generic-AI look the prompt forbids

**Fixes G1.**

### What the prompt says

> Left unattended, a model reaches for the same page every time: **a near-black background, one
> indigo-to-violet accent gradient, monospace numerals**, and a grid of cards that all look alike.
> That is not a design decision — it is the absence of one, and users recognise it instantly.

### What the template hands it

`templates/vite-react/src/App.tsx`:

```tsx
<main className="min-h-screen bg-slate-950 text-slate-100">
  <p className="text-sm font-medium uppercase tracking-widest text-sky-400">{{projectName}}</p>
  <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Your app starts here.</h1>
  ...
  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 font-mono text-sm ...">
```

A near-black background (`slate-950`), a single cool accent (`sky-400`), uppercase tracked
micro-type, and a monospace box. That is the pattern, in the file the agent opens first.

The prompt then asks it to *"derive an identity from what the product IS; do not fall back to the
default dark-and-purple."* The agent has to actively undo its own scaffold to comply. Most of the
time it edits around what is there, because editing around what is there is exactly what
`edit_file`-over-`write_file` and *"match whatever conventions already exist in the project"* tell
it to do. Two good instructions pointing at a bad starting point.

Worth noting: `templates/expo-react-native` does **not** have this problem — it opens on
`bg-white` / `text-neutral-900` with no accent colour at all. The newer template already got this
right, which is the clearest evidence that the old one is a legacy artifact rather than a decision.

### The change

Make the default scaffold **neutral**, not styled. It should look like an unpainted room, not like
somebody's design:

- A plain light surface (`bg-white` / `text-neutral-900`), with `dark:` variants if you want both.
- No accent colour at all. An accent is an identity decision and the template has no identity.
- No `font-mono` anywhere. No uppercase tracked labels.
- Keep it visibly *unfinished* — the copy already says "Your app starts here", which is right.

The bar: a screenshot of the template should tell a designer nothing about what the app is going to
look like. Today it tells them "dark SaaS".

---

## 2. There is nowhere to put a type scale or a spacing scale

**Fixes G2.**

### What is true

`templates/vite-react/src/index.css` is one line:

```css
@import "tailwindcss";
```

That is the whole design surface. Meanwhile the prompt says:

> Commit to a type scale and a spacing scale, and use them; do not size things one-off.

and Architect Mode requires a `DESIGN.md` with *"the colour ROLES with a starter palette (real
values, light/dark if both), the type direction and scale, spacing/radius/elevation direction."*

There is no file for any of that to land in. So the agent does one of two things, and both are worse
than the third option it does not have:

- inlines one-off Tailwind values in every component — the exact thing the prompt forbids; or
- creates a new file for tokens — which costs it a slot against the restraint budget (see G3 and
  finding F6, where the same dynamic plays out with icons).

### The change

Give `index.css` a token layer using Tailwind v4's own `@theme` block, pre-filled with neutral
values and commented as the place to edit:

```css
@import "tailwindcss";

/* This project's design tokens. Change the values here rather than
   hard-coding one-off sizes and colours in components. */
@theme {
  --color-brand-50:  ...;   /* set an identity — do not leave these neutral */
  --font-display:    ...;
  --radius-card:     ...;
}
```

Two things this buys beyond tidiness. The agent gets an obvious, conventional home for a decision
the prompt already demands — so "commit to a scale" becomes a file edit rather than an act of
invention. And `DESIGN.md`'s starter palette gets somewhere to be *implemented*, which is currently
the gap between the Architect writing a design system and the build using one.

---

## 3. Icons: forbidden by prompt, absent from the template

**Fixes G3. Measured, not theorised.**

### The bind

`templates/vite-react/package.json` ships exactly two dependencies — `react` and `react-dom`. There
is **no icon set**. And `prompt.ts:149` says:

> NEVER emoji as iconography or as a stand-in for a real icon set.

So the agent has three options, and two are closed:

| option | outcome |
| --- | --- |
| emoji | forbidden by the prompt |
| install an icon library | adds a dependency; some eval cases assert `no_new_dependency` |
| hand-write SVG components | the only compliant path — costs a file, every time |

It takes the third, correctly, and then gets marked down for the file.

### The measurement

Every restraint failure across the 2026-09-01 `claude-opus-5` runs was one of these files:

| run | case | the file that broke the cap |
| --- | --- | --- |
| 1 | `landing-page` | `src/components/Wordmark.tsx` |
| 2 | `todo-app` | `src/components/icons.tsx` |
| 2 | `pricing-toggle` | `src/pricing/CheckIcon.tsx` |
| — | gpt-5.2 `dashboard-layout` | `src/components/icons.tsx` |

Four occurrences across four runs, on the two strongest models. `gemini-3.7-flash` produced none —
which is not a point in its favour: it is the model least likely to honour the no-emoji rule in the
first place.

**The stronger the model, the more reliably it follows the instruction, and the more it is penalised
for it.** That is a prompt/template mismatch producing a measurable false signal, not an agent
fault.

### The change — two options, both real

**Option A — one line in the prompt (cheapest).** Next to the existing no-emoji rule:

> When you draw icons by hand, keep them all in a single `src/components/icons.tsx` and export one
> component per icon. Do not create a file per icon.

Costs one file instead of several, and produces better-organised code regardless of any eval. Both
Opus 5 and gpt-5.2 already choose `icons.tsx` when they think of it — this just makes it reliable.

**Option B — ship an icon set in the template.** Add `lucide-react` to `templates/vite-react`.
Removes the bind entirely: there is a real icon set, so the no-emoji rule has an obvious compliant
answer that costs zero files. The cost is a dependency in every project whether it is used or not.

**Recommendation: both, A first.** A is one sentence and helps every project including those that
deliberately avoid dependencies. B is the better long-term answer because real applications need
icons and hand-drawn SVG is not what a senior team ships.

**Do not ship either without measuring it.** This is a prompt change; the review's own rule is that
prompt changes get a before/after eval run on `claude-opus-5`. The five-case set is ~$3 and four
minutes, and the baselines already exist (`2026-09-01T10-54-08-227Z.json`,
`2026-09-01T11-13-30-188Z.json`).

---

## What this adds up to

| change | fixes | effort | payoff |
| --- | --- | --- | --- |
| Neutral default scaffold — no dark, no accent, no mono | G1 | small | the agent stops having to undo its own starting point |
| `@theme` token block in `index.css` | G2 | small | "commit to a scale" and `DESIGN.md` finally have somewhere to land |
| Icons-in-one-file prompt rule | G3 | one line | removes a measured false restraint failure |
| `lucide-react` in the template | G3 | small | removes the bind entirely |

Four files. No agent logic, no API change, no new abstraction. Of everything in this folder, this is
the highest ratio of user-visible quality to effort — because it changes what *every* project looks
like on turn one, on every model, in every mode.

---

## What you need to do

Nothing here is urgent enough to jump the queue in [07-roadmap.md](./07-roadmap.md), but all four
are small enough to do in an afternoon, and the template changes (G1, G2) need no eval run because
they do not touch the prompt — a screenshot of the scaffold is the whole test.

**Next:** back to [07-roadmap.md](./07-roadmap.md).
