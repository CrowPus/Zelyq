# `/motion` — turning a built site into a moving one

**Status:** step 1 done — the stack is proven and the template is ready. Written 2026-09-03.

`/clone` points at somebody else's site and rebuilds it. `/motion` points at **the project you already
have** and gives it a motion system. Different direction, different problem: nothing is being copied,
so there is no reference to be faithful to — the agent has to decide what should move, and why.

This is what I understand about Motion Primitives after reading it, and what I think `/motion` should
be.

## What Motion Primitives actually is

Everything here was read from the repository and the registry, not from the marketing page — the
site rate-limited every request I made to it (HTTP 429), which is itself worth knowing before we
depend on it at runtime.

| | |
|---|---|
| What | 33 React components that animate, by ibelick |
| Licence | **MIT** |
| Built on | `motion` (Framer Motion's successor) + Tailwind |
| Stars | ~6,200 |
| Distribution | **shadcn-format registry** — source is copied into your project, not installed as a package |
| Runtime dependencies, across all 33 | **`motion`, and `react-use-measure` for three of them** |

That last row is the important one. This is not a framework. There is no provider to mount, no
config file, no build step. Two packages and some source files.

### It is a registry, so there is nothing to shell out to

Each component is one JSON file with its **source inlined**:

```
https://raw.githubusercontent.com/ibelick/motion-primitives/main/public/c/in-view.json
→ { name, dependencies: ["motion"], files: [{ path, content }] }   1,134 chars
```

There is an official CLI (`npx motion-primitives add <name>`), and the registry is also
shadcn-compatible, so `npx shadcn add <url>` works too. **`/motion` should use neither.** One HTTPS
GET returns the component and its dependency list, which fits the fetch-with-SSRF-guard shape
`capture_reference` already uses, and avoids running a third-party CLI inside a user's project.

## How it works — and the part that matters for us

The 33 components split into two kinds, and the split is the whole design.

### Wrappers — they animate markup that already exists

These take existing JSX as children and animate it **without changing it**:

- **`InView`** — animates `hidden → visible` when the element scrolls into view. Takes `variants`,
  `transition`, `viewOptions`, `once`.
- **`AnimatedGroup`** — same, for a list, with the children staggered. Ships ten presets: `fade`,
  `slide`, `scale`, `blur`, `blur-slide`, `zoom`, `flip`, `bounce`, `rotate`, `swing`. Default
  stagger is 0.1s.

That is the entire mechanism for turning a static page into a moving one:

```tsx
<section>              →   <InView variants={…} transition={…}>
  <h1>…</h1>                 <section>
  <p>…</p>                     <h1>…</h1>
</section>                     <p>…</p>
                             </section>
                           </InView>
```

**The content is untouched.** That is what makes `/motion` tractable and safe: for the majority of a
page it is a *wrapping* operation, not a rewrite. A rewrite risks losing copy, breaking layout,
dropping a prop. A wrap cannot.

### Replacements — they take over an element

`TextEffect`, `TextShimmer`, `TextRoll`, `TextScramble`, `TextMorph`, `SpinningText`,
`AnimatedNumber`, `SlidingNumber`, `InfiniteSlider`, `Carousel`, `Accordion`, `Dialog`,
`MorphingDialog`, `Disclosure`, `TransitionPanel`, `Dock`, `Toolbar*`, `ImageComparison`.

These substitute for something. `<h1>Build faster</h1>` becomes `<TextEffect per="word">Build
faster</TextEffect>`. Higher value and higher risk — this is where a careless pass mangles a page.

### Effects — they decorate a surface

`Tilt`, `Magnetic`, `Spotlight`, `GlowEffect`, `BorderTrail`, `Cursor`, `ProgressiveBlur`,
`AnimatedBackground`, `ScrollProgress`. Mostly hover- and cursor-driven, mostly opt-in per element,
mostly the difference between "animated" and "expensive-feeling".

## Why this fits Zelyq specifically

Zelyq's `vite-react` template is **React 19 + Vite 6 + Tailwind 4 + TypeScript**. Motion Primitives
is built against **Tailwind 4** and `motion` declares `react: ^18 || ^19`. The stacks line up, which
is not something to take for granted — a component library pinned to Tailwind 3 would have needed a
config shim per component.

Three gaps, all small, all one-time:

| Gap | Fix |
|---|---|
| Template has no `motion` dependency | add `motion` (and `react-use-measure` only if a component needs it) |
| Components import `cn` from `@/lib/utils` | write the four-line `cn` helper, add `clsx` + `tailwind-merge` |
| **Template has no `@/` path alias** | add `paths` to `tsconfig` and `resolve.alias` to `vite.config.ts` |

The third is the one that silently breaks everything if missed, and it is worth fixing in the
template itself rather than per project.

## What `/motion` should be

**Not** "install a component library". The library is the easy part. `/motion` is the judgement about
what should move — and the agent is now, for the first time, equipped to have that judgement, because
`browse_page` taught it to read motion off real sites.

A pass over the project, in this order:

**1. Read the project as it is.** Which sections exist, what they are (hero, feature grid,
testimonial list, pricing table, footer), what is already animating. This is a code read, not a
capture — the source is right there.

**2. Choose a grammar before choosing effects.** The `web-motion-engineering` skill already
establishes this: continuity, rupture, or hybrid, decided once and applied throughout. A page where
every section animates differently reads as broken, not rich.

**3. Apply the wrapper layer first.** `InView` on sections, `AnimatedGroup` on anything that is a
list of siblings. This is mechanical, safe, and on its own is most of the perceived difference.

**4. Apply replacements sparingly, and only where they mean something.** The hero headline gets
`TextEffect`. A metric gets `AnimatedNumber`. A logo row gets `InfiniteSlider`. One or two per page.
The failure mode is a page where everything is scrambling and shimmering at once.

**5. Effects last, and rarely.** `Tilt` on cards, `Spotlight` on a dark hero. These are seasoning.

**6. Verify.** `start_preview` → `browse_page` **against the project's own preview**. That is the
part I would insist on: the agent can now walk its own page and read back the motion it just wrote,
in the same vocabulary it reads other people's sites. If the walk reports "Motion: none observed",
the pass failed and the agent knows without being told.

That loop — write motion, walk your own page, read what actually runs — does not exist in any tool I
know of, and we have both halves already.

### Where the real difficulty is

Choosing what to animate is not a lookup. Some of it is inferable from structure and some is not:

- A `<section>` with one heading and one paragraph is a statement → `InView`, slow, `blur-slide`.
- A `<div>` with six near-identical children is a grid → `AnimatedGroup`, `slide`, stagger 0.06s.
- A number with a `%` or `$` next to it is a metric → `AnimatedNumber`.
- A row of `<img>` with brand-ish filenames is a logo wall → `InfiniteSlider`.

Those are heuristics, and they should live in a **skill**, not in tool code — the same way
`complete-replica-engineering` carries the clone workflow. Tool code that guesses at intent ages
badly; a skill can be argued with and improved.

### `/motion` with a URL

`/motion https://linear.app` should mean *give this project a motion system like that one's*, and it
is nearly free: `browse_page` already returns exactly the numbers needed — `420ms
cubic-bezier(0.25, 0.46, 0.45, 0.94), transform + opacity, staggered 0–326ms` maps directly onto an
`AnimatedGroup` `transition` and `staggerChildren`. Reading a site's motion and *writing* that motion
are the same vocabulary, which is a genuinely unusual position to be in.

## What already exists here to build on

| | |
|---|---|
| `skills/web-motion-engineering/` | the motion doctrine: grammar, easing, reduced motion, performance budgets, an audit script |
| `skills/cinematic-web/` | the heavy end — scroll-driven, WebGL, 3D |
| `cinematic_pass` | a specialist that already exists and already owns dramatic motion |
| `browse_page` + `motion.json` | reading motion off any page, including our own preview |
| `skills/shadcn-ui-setup/` | precedent for a component-installation skill |

`/motion` is the missing middle: `web-motion-engineering` says *how motion should behave*,
`cinematic-web` handles *spectacle*, and nothing yet does the ordinary, high-value job of giving a
normal, finished site a coherent motion system.

**It should not become a fourth motion skill.** `/motion` force-weaves `web-motion-engineering` for
doctrine, exactly the way `/clone` force-weaves `complete-replica-engineering`, and adds one new
skill for the Motion Primitives catalogue and the placement heuristics.

## Risks

**The obvious failure is too much motion.** A page where every element fades up on scroll is a page
that feels slow. The dwell rule from the body work applies here too: restraint is the feature. The
skill should cap it — one replacement per section, effects on request only.

**Reduced motion is not optional.** Every wrapper needs a `prefers-reduced-motion` branch, and it has
to be built in from the first pass, not audited in afterwards. `web-motion-engineering` already says
this; `/motion` is where it gets tested.

**It is somebody else's code, copied in.** MIT, so licence-clean, but the components land in the
user's project and become theirs to maintain. Provenance should be recorded — a
`motion/PROVENANCE.md` naming each component, its source URL and the commit it came from, the way
`/clone` writes `asset-gaps.md`.

**The registry could move.** The site is already rate-limiting us. Fetching from
`raw.githubusercontent.com` is more robust than the site, but a vendored snapshot of the 33
components in-repo — like `design-md/` — removes the runtime dependency entirely. Worth deciding
before building, not after.

**React 19 is not fully proven.** `motion` declares support and Motion Primitives builds on Tailwind
4, but their own app pins React 18. The first thing to do is add two components to a real generated
project and see them run.

## What I would build first

1. **Prove the stack.** Add `motion`, the `cn` helper and the `@/` alias to the `vite-react`
   template; drop `InView` and `AnimatedGroup` into a generated project; run it. If React 19 has a
   problem, everything below changes.
2. **The catalogue skill** — 33 components, what each is for, and the placement heuristics. This is
   the substance, and it is writing, not code.
3. **`/motion` in the composer** — the same shape as `/clone`: a directive plus a force-woven skill,
   with the chip that now exists.
4. **The verification loop** — `start_preview` → `browse_page` on the project's own URL, and refuse
   to report success when the walk finds no motion.

Step 1 is a morning and it is the only step that can invalidate the rest.

## The three decisions, made

### 1. Vendor the components. Do not fetch at run time.

| | |
|---|---|
| All 33 components, as registry JSON | **159 KB** |
| Commits touching `components/core`, ever | 88, over 20 months |
| Last upstream change | **2026-03-19** — six months ago |
| `design-md/`, already vendored in this repo | 2.8 MB |

Every number points the same way. It is a fifth of a percent of what this repo already carries for
the design library, upstream is quiet, and the site is already rate-limiting us at HTTP 429.

The argument that decides it is not size, though — it is that **fetching would pipe unreviewed
third-party code into a user's project at generation time**. A compromised or simply changed registry
would land in someone's build without anyone here having read it. That is a supply-chain risk we
would be adding for the benefit of tracking a library that changes twice a year.

So: `motion-primitives/` in-repo, pinned to an upstream commit, with

- `PROVENANCE.md` — component, source URL, upstream commit, MIT notice (the licence requires the
  attribution, and `/clone` already sets the precedent with `asset-gaps.md`)
- a `refresh.mjs` that re-pulls the registry and shows a diff, so updating is a reviewed act rather
  than an ambient one

### 2. Yes — `/motion` takes an optional URL.

- `/motion` — a tasteful default pass, using the placement heuristics.
- `/motion <url>` — **wear that site's motion.**

The second is the reason to build this at all, and it is nearly free: `browse_page` already returns
`420ms cubic-bezier(0.25, 0.46, 0.45, 0.94), transform + opacity, staggered 0–326ms`, and
`AnimatedGroup` takes a `transition` and a `staggerChildren`. Those are the same numbers. Reading a
site's motion and writing motion are already one vocabulary here; not connecting them would be
leaving the interesting half on the floor.

The risk is confusion with `/clone <url>`, which takes the same argument and means something much
bigger. The composer chip settles it — `clone noth.in` rebuilds the site, `motion like noth.in`
takes only its timing — and the two directives should say so in their first line.

### 3. The line between `/motion` and `cinematic_pass` is **structure**.

Not "everyday versus spectacle", which is how I put it in the first draft and which is too vague to
act on. Reading what `cinematic_pass` actually declares gives a testable rule:

| | `/motion` | `cinematic_pass` |
|---|---|---|
| Scope | the whole project | **one screen** |
| Needs assets | no | **yes — it pauses and asks for footage** |
| Changes the page's structure | **never** — it wraps existing markup | yes — rebuilds that screen as a scroll experience |
| Output | components + a motion system | `CINEMATIC.md` + a Scroll Storyboard |

`/motion` may not restructure anything. The moment a pass wants to pin a section, scrub footage, or
hand off to a canvas, it is not `/motion` any more and it should say so and stop. That constraint is
also what makes `/motion` safe to run on a finished project: a wrap cannot lose your copy.

They do overlap on one thing — both will reach for the hero. `/motion` gets it by default;
`cinematic_pass` takes it when the user asks for scroll-cinema, and then `/motion` leaves that screen
alone.

## What I would build first

1. ~~**Prove the stack.**~~ **Done — see below. It did not pass first time.**
2. **Vendor the 33**, with provenance and the refresh script.
3. **The catalogue skill** — what each component is for, and the placement heuristics. This is the
   substance of the feature, and it is writing rather than code.
4. **`/motion` in the composer**, the same shape as `/clone`: a directive, a force-woven skill, and
   the chip that now exists.
5. **The verification loop** — `start_preview` → `browse_page` against the project's own URL, and a
   refusal to report success when the walk finds no motion.

Step 1 is a morning, and it is the only step that can change the rest.

---

## Step 1: what proving the stack actually found

A generated `vite-react` project, `motion@13.2.0`, `react@19.2.8`, `InView` and `AnimatedGroup`
pulled from the live registry, built and run.

### Motion Primitives does not typecheck under React 19

This is the finding the step existed for, and it would have surfaced later as "every generated
project fails verification" rather than as one afternoon.

```
animated-group.tsx(119,37): error TS2503: Cannot find namespace 'JSX'.
animated-group.tsx(132,7):  error TS2769: Property 'className' does not exist on type …
```

Upstream writes `motion.create(as as keyof JSX.IntrinsicElements)`. **React 19 removed the global
`JSX` namespace** — it is `React.JSX` now. The cast then fails, `motion.create` loses the element's
prop types, and `className` goes with it. Zelyq's template runs `typecheck` on every turn, so this is
not cosmetic: it fails the turn.

The fix is three characters and two casts, local to one hook:

```diff
- motion.create(as as keyof JSX.IntrinsicElements)
+ motion.create(as as keyof React.JSX.IntrinsicElements)
+ ) as React.ElementType;
```

`in-view.tsx` was already fine. I have not audited the other 31.

**This settles decision 1 beyond the size argument.** Vendored, the patch is a file in our repo that
we own and can test. Fetched at run time, this breaks in a user's project with no way to fix it
except waiting for upstream — and upstream last shipped six months ago.

### The verification loop is blocked by our own SSRF guard

`browse_page` refuses `http://127.0.0.1:4399/`:

```
Refused http://127.0.0.1:4399/: only ports 80 and 443 are allowed, got 4399
```

That guard is correct — the tool takes a URL from the model and must not be pointable at the host's
own network. But it means the loop this document proposed cannot be built by handing `browse_page` a
preview URL.

The fix follows the shape `view_preview` already uses: a tool that takes **no URL** and asks the
runtime where this project's preview is. The model cannot point it anywhere, so nothing is relaxed.
Call it `walk_preview`; it is the same `walkPage` engine behind a trusted address.

### The loop itself works

Driving `walkPage` directly against the running proof page, it read back exactly what had been
written:

| Written by hand | Read back off the running page |
|---|---|
| `InView`, `420ms`, `cubic-bezier(0.25, 0.46, 0.45, 0.94)` | `×2 420ms cubic-bezier(0.25, 0.46, 0.45, 0.94) → opacity` |
| `AnimatedGroup preset="blur-slide"`, stagger `0.1s` | `×21 300ms → opacity, staggered 0–500ms` |

Write motion, walk your own page, read the real numbers back. That is the loop, and it is real.

### What motion costs a project

| | JS bundle | gzip |
|---|---|---|
| Template as it ships | 215 KB | **67.8 KB** |
| With `motion` + two components | 323 KB | **103 KB** |

**35 KB gzip.** Which is why `motion` does *not* go in the template — a project that never animates
should not carry it. `/motion` adds it when it runs.

### What went into the template

| | |
|---|---|
| `tsconfig.json` | `baseUrl` + `paths` for `@/*` |
| `vite.config.ts` | the matching `resolve.alias` |
| `src/lib/utils.ts` | the `cn` helper |
| `package.json` | `clsx`, `tailwind-merge` — about 5 KB, and they unlock shadcn/ui too |

Verified by generating a project from the changed template, importing `@/lib/utils`, and running
typecheck and build.
