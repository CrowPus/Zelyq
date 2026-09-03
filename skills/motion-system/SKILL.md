---
name: motion-system
description: Give an existing project a coherent motion system — scroll reveals, staggered groups, text and number effects, hover and cursor treatments — by wrapping the markup that is already there rather than rewriting it. Use for `/motion`, for "add animation", "make it feel alive", "give it motion like <site>", or when a finished page is correct but static. Do not use for scroll-scrubbed video, pinned sections, or canvas experiences — that is cinematic_pass.
metadata:
  author: Zelyq
  version: "1.0.0"
---

# Motion System

## What this is for

A page that is finished and correct, and static. This adds motion to it **without changing what is
on it**.

The rule that makes that possible: `add_motion`'s two wrappers take existing markup as children.

```tsx
<section>            →   <InView variants={…} transition={…}>
  <h1>…</h1>                 <section>…exactly as it was…</section>
  <p>…</p>                 </InView>
</section>
```

**Wrap. Do not rewrite.** A rewrite loses copy, drops props and breaks layouts; a wrap cannot. When
you find yourself retyping the contents of a section, stop — that is not this job.

## Hard boundaries

- **Never restructure the page.** No pinning, no scroll-scrubbed video, no canvas hand-off, no
  reordering sections. If the work needs any of that, say so and stop: it is `cinematic_pass`, which
  owns one screen, takes footage, and rebuilds it. This owns the whole project and rebuilds nothing.
- **Never animate a form control, a validation message, or anything the user is waiting on.**
- **Reduced motion is not a follow-up.** Every pass ships it. See below.

## The order of work

**1. Read the project first.** List the routes and components; read them. You are looking for what
each section *is* — a hero, a feature grid, a logo wall, a metric, a testimonial list, a footer.
Motion follows meaning, and meaning is in the markup.

**2. Pick one grammar and hold it.** The `web-motion-engineering` skill defines them: continuity
(restrained, image-led, seamless), rupture (deliberately unstable, collage-like), or a hybrid that
changes grammar at one explicit boundary. A page where every section animates differently reads as
broken, not rich. Decide once, write it down, apply it everywhere.

**3. Install only what you will use.** `add_motion({ components: [...] })` copies them in, brings
their hooks, writes the `cn` helper if absent, and adds packages. Then `npm install`. Do not install
the catalogue.

**4. The wrapper layer, everywhere.** This is most of the perceived difference and it is the safe
part.

**5. Replacements, sparingly.** One or two per page.

**6. Effects, rarely.** Seasoning, not seasoning on everything.

**7. Verify, and believe the measurement.** `start_preview`, then `walk_preview`. It reports the real
durations, easings and staggers the page runs. **If it reports no motion, the pass failed** — the
components are not imported, not rendered, or you edited a page the route does not use. Never report
success from having written the code; report it from what the walk measured, and quote the numbers.

## Choosing what moves

Structure tells you most of it.

| What you see in the markup | What it is | What to use |
|---|---|---|
| A section with one heading and one paragraph | a statement | `in-view`, slow, `blur-slide` |
| A parent with 3+ near-identical children | a grid or list | `animated-group`, `slide`, stagger 0.06–0.1s |
| The first section on the page | the hero | `in-view` on the whole, `text-effect` on the headline only |
| A number with `%`, `$`, `+`, `k`, `m` beside it | a metric | `animated-number` |
| A row of logos or `<img>` with brand-ish names | a logo wall | `infinite-slider` |
| Cards with a border and a hover state already | interactive surfaces | `tilt`, low intensity |
| A dark section with a single focal element | a feature | `spotlight` |
| A long article or docs page | reading | `scroll-progress` only |
| Footer, legal, nav | plumbing | **nothing** |

When structure does not tell you, leave it alone. An un-animated section is invisible; a
wrongly-animated one is noticed.

## Restraint, concretely

- **At most one replacement per section**, and not in every section.
- **Never two text effects on one screen.** A headline that scrambles above a subhead that shimmers
  reads as a broken page, not a designed one.
- **Nothing infinite above the fold** except a background. A looping shimmer next to a call to
  action pulls the eye away from it forever.
- **Duration 200–600ms** for anything the user is waiting behind; up to 1200ms for ambient reveals.
- **`once` on scroll reveals.** Content that re-animates every time it re-enters is a page that never
  settles.
- **Stagger ≤ 0.1s and ≤ 8 children.** A 20-item stagger at 0.1s is a two-second wait for the last
  card.

## Taking motion from another site

With `/motion <url>`, run `browse_page` on it **first**. It reports the site's real system, e.g.:

```
×438  420ms cubic-bezier(0.25, 0.46, 0.45, 0.94) → transform + opacity, staggered 0–326ms
```

Those map straight across:

```tsx
<AnimatedGroup
  variants={{
    container: { visible: { transition: { staggerChildren: 0.06 } } },
    item: { hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0 } },
  }}
  transition={{ duration: 0.42, ease: [0.25, 0.46, 0.45, 0.94] }}
>
```

Take the **timing**, not the layout. This is not a clone, and the reference site's sections are not
this project's sections. If the walk reports the site is driven by GSAP with little the animation API
can see, use the `scriptMotions` lines — they carry the same information as `slide`, `fade`, `scale`
with real extents.

## Reduced motion

Every pass ships this. `motion` respects it through `useReducedMotion`, but the wrappers do not read
it for you:

```tsx
import { useReducedMotion } from "motion/react";

const reduce = useReducedMotion();
<InView
  variants={
    reduce
      ? { hidden: { opacity: 1 }, visible: { opacity: 1 } }
      : { hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0 } }
  }
  transition={{ duration: reduce ? 0 : 0.42 }}
>
```

The content must be **fully visible and final** under reduced motion. Never leave an element at
`opacity: 0` because its animation was skipped — that is a page that appears empty to the people who
asked for less motion.

## The catalogue

33 components, vendored and patched for React 19 — see `motion-primitives/PROVENANCE.md`. Install by
name with `add_motion`, import from `@/components/motion/<name>`.

| Kind | Components |
|---|---|
| **Wrappers** — animate existing markup | `in-view`, `animated-group` |
| **Text** — replace a heading or label | `text-effect`, `text-shimmer`, `text-shimmer-wave`, `text-loop`, `text-morph`, `text-roll`, `text-scramble`, `spinning-text` |
| **Numbers** | `animated-number`, `sliding-number` |
| **Effects** — decorate a surface | `tilt`, `magnetic`, `spotlight`, `glow-effect`, `border-trail`, `cursor`, `progressive-blur`, `animated-background`, `scroll-progress` |
| **Structure** — replace a widget | `carousel`, `infinite-slider`, `accordion`, `disclosure`, `dialog`, `morphing-dialog`, `morphing-popover`, `transition-panel`, `dock`, `toolbar-dynamic`, `toolbar-expandable`, `image-comparison` |

Read [references/components.md](references/components.md) for what each one does and its props before
using one you have not used before. Read
[references/recipes.md](references/recipes.md) for the four passes worth knowing by heart.

## Definition of done

- One grammar, applied throughout, written down in the summary.
- Every reveal has a reduced-motion branch, and the page is complete without motion.
- `npm run typecheck` and the build pass.
- `walk_preview` reports motion, and the summary **quotes what it measured** — durations, easings,
  staggers — rather than claiming the page animates.
- Nothing was restructured.
