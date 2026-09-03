# Four passes worth knowing by heart

Each is a whole treatment, not a snippet. Pick one, apply it to the project, and hold it.

Every example assumes `add_motion` has run and `useReducedMotion` is imported from `motion/react`.
The reduced-motion branch is written out once here; do not ship any of these without it.

---

## 1. Editorial — the default

Restrained, slow, image-led. Right for almost any finished marketing or product page, and the one to
reach for when nobody has said otherwise.

**Grammar:** continuity. One curve, one distance, everywhere.

```tsx
const EASE = [0.25, 0.46, 0.45, 0.94] as const;

function Reveal({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <InView
      once
      viewOptions={{ margin: "0px 0px -120px 0px" }}
      variants={
        reduce
          ? { hidden: { opacity: 1 }, visible: { opacity: 1 } }
          : { hidden: { opacity: 0, y: 24, filter: "blur(4px)" },
              visible: { opacity: 1, y: 0, filter: "blur(0px)" } }
      }
      transition={{ duration: reduce ? 0 : 0.5, ease: EASE }}
    >
      {children}
    </InView>
  );
}
```

Wrap every section in it. Grids get `AnimatedGroup preset="blur-slide"` with `staggerChildren: 0.06`.
The headline — **one** headline, the first — gets `text-effect` with `per="word"`. Nothing else.

`viewOptions.margin` with a negative bottom is what stops a reveal firing while the element is still
below the fold: it starts as the section rises into the last 120px, so it is finished by the time the
reader arrives at it.

---

## 2. Product — quiet and quick

For dashboards, apps, docs. Motion here is feedback, not atmosphere. Shorter, no blur, no stagger
worth noticing.

```tsx
transition={{ duration: reduce ? 0 : 0.22, ease: [0.4, 0, 0.2, 1] }}
variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
```

Use `in-view` on cards and panels, `animated-number` on metrics, `scroll-progress` on long documents.

**No text effects at all.** A dashboard whose headings scramble is a dashboard nobody trusts.

---

## 3. Studio — deliberate and heavier

For portfolios and agencies, where the motion is part of the argument. Longer, larger distances, and
one moment of real character.

```tsx
variants={{
  hidden: { opacity: 0, y: 64, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1 },
}}
transition={{ duration: reduce ? 0 : 0.9, ease: [0.16, 1, 0.3, 1] }}
```

Plus, and only one of these on the whole site: `text-scramble` on the studio name, `spinning-text`
around a mark, or `tilt` on the work grid. Pick one. Two is a showreel of effects rather than a
studio with a voice.

`infinite-slider` for a client logo wall, `progressive-blur` at the edges of it so it fades rather
than clipping.

---

## 4. Matching a site

`/motion <url>` — run `browse_page` first and build from what it measured.

Reading its report:

| Line from `browse_page` | What to write |
|---|---|
| `420ms cubic-bezier(0.25, 0.46, 0.45, 0.94) → transform + opacity` | `transition={{ duration: 0.42, ease: [0.25, 0.46, 0.45, 0.94] }}` and vary `y` + `opacity` |
| `staggered 0–326ms` across ~50 elements | `staggerChildren` around `0.326 / children.length`, capped at 0.1 |
| `spring-like (linear() with 30 stops)` | `transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}` — approximate it, never copy the samples |
| `Ambient loops — 11950ms → opacity, loops` | a background only, and only if the design has one |
| `Driven from script by gsap … ×81 slide — translateY 73.6px → 27.6px` | a `y: 74 → 28` reveal; the extents are literal |
| `Pinned layers: nav — fixed, 58px, opacity 0 → 1` | a sticky header that fades in past the fold — plain CSS plus `useScroll`, not a component |

**Take the timing, not the layout.** The reference's sections are not this project's sections, and a
page that copies both is a bad clone rather than a good motion pass.

---

## What none of these do

No pinning. No scroll-scrubbed video. No canvas. No reordering. If the work wants those, it is
`cinematic_pass` — hand it over and say so.
