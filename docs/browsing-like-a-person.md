# Browsing like a person

**Status:** built. Written and implemented 2026-09-03.

A clone comes back looking right and feeling wrong. The founder's description of why is exact: *you
can tell it just took a screenshot — it does not feel the content inside.* Scroll the original and
there is motion, transition, video, things arriving as you reach them. None of that survives.

This asks what the agent actually experiences of a website today, and what it would take for it to
experience the page instead of photographing it.

## What the agent does today

Three tools drive a browser. Only one of them ever looks at somebody else's site:
`capture_reference`, the `/clone` path. Reading it end to end turns up three findings, and together
they explain the complaint completely.

### It deliberately erases the motion

```ts
const shot = await page.screenshot({ fullPage: true, animations: "disabled" });
```

`animations: "disabled"` is the right call for a geometry baseline — it settles every animation and
transition so the capture is deterministic. But it is the **only** artifact of the page's behaviour,
so settling it is also the end of the story. Nothing else records that anything ever moved.

### Its scroll is a lazy-load trick, not a read

```ts
const SCROLL_THROUGH = `async () => { … y += window.innerHeight; setTimeout(step, 60) … }`;
```

A screenful every 60 ms, then back to the top. That is enough to make `loading="lazy"` images fetch,
which is what it was written for. It is not enough to *see* anything: the reveal animation this repo
measured on Linear runs for 420 ms, so the page is already seven screens further down before its
first reveal would have finished.

### The agent never sees the pixels

`read_file` on one of the PNGs it just captured returns:

```
clone/stripe.com/reference/index/1280.png is a binary file (1483204 base64 chars).
```

That is the whole result. The model builds the clone from `dom.html`, `geometry.json`, a resource
manifest and a text summary. **It has never looked at the site it is copying.**

The asymmetry is the sharp part. `view_preview` returns `images: [...]` and puts real pixels in front
of the model — so during the build loop the agent can see *what it made*, in a loop, as often as it
likes. It simply cannot see *what it is copying*. It is drawing from a blueprint and a description,
then checking its work against the only photograph it is allowed to look at, which is a photograph of
its own work.

### And the skill already asks for what no tool can produce

`skills/complete-replica-engineering/references/motion-scroll-and-time.md` instructs the agent to
record a motion fingerprint — *trigger, duration, easing/spring, delay/stagger, property, origin,
entering/exiting state* — and to "capture scroll checkpoints".

There is no tool that can observe any of it. The skill is asking for evidence the agent has no way
to gather, so it either omits the section or invents it. That is worse than not asking.

## What is actually available — measured

All figures below come from running this repo's own Playwright against the live sites, not from
documentation.

### The browser already knows every animation exactly

`document.getAnimations()` returns every running animation and transition with its real timing —
duration, delay, easing, iterations, and which properties are being animated. Not parsed out of CSS
text, not inferred: the values the compositor is using.

From stripe.com, one entry, verbatim:

```
duration 325 ms   delay 450 ms   easing cubic-bezier(0.33, 1, 0.68, 1)   property transform
```

That is the motion fingerprint the skill asks for, complete, for free.

### But only if you scroll — and this is the whole finding

| | Motions visible at load | Motions visible after walking the page |
|---|---:|---:|
| stripe.com | 3 | **96** |
| linear.app | — | **189** |

A static load sees **3%** of stripe.com's motion. Everything else is scroll-triggered and simply has
not happened yet. Photographing the page at the top is not a partial view of its behaviour; it is
almost none of it.

### Grouped, the noise turns into the design system

Raw, 189 motions is unusable. Grouped by signature it is one line:

| Signature | Times used on linear.app |
|---|---:|
| `420ms · transform + opacity` | **164** |
| `1500ms · cubic-bezier(.455,.03,.515,.955) · opacity` | 3 |
| `2000ms · background-position` (ambient loop) | 2 |

The top row *is* Linear's reveal system. One number, one easing, two properties, applied 164 times.
A clone that reproduces that one rule is far closer to the original than one that reproduces none of
it, and it costs a single line to carry.

Stripe groups the same way: a `1420ms transform` used 18 times, and an `11950ms` ambient loop — which
is a background that drifts forever, not a reveal, and the duration alone says so.

### Video can be played and looked at

On a page with `<video>`, the agent can start it, seek it, and pull frames:

- `play()` works headless with `--autoplay-policy=no-user-gesture-required`
- seeking to 10% / 40% / 70% and grabbing each frame yields ~9 KB JPEGs at 480 px wide
- the useful metadata is all there: `duration`, `loop`, `muted`, `autoplay`, `poster`, intrinsic vs
  rendered size, `object-fit`

The distinction that matters for a clone is **role**, and it is derivable: a `<video>` rendered wider
than the viewport, muted, looping and autoplaying is a background hero; one at 600 px with
`controls` is content. Those are different things to rebuild and today both come back as nothing.

One caveat found rather than assumed: `canvas.drawImage(video)` taints on a cross-origin video and
`toDataURL` then throws. `page.screenshot({ clip: videoRect })` has no such problem and should be the
mechanism.

### What the walk costs

An eight-stop walk of the full page, pausing 600 ms at each stop, with a checkpoint screenshot each:

| | Page height | Load | Walk | Checkpoints |
|---|---:|---:|---:|---:|
| stripe.com | 15,012 px | 7.4 s | **10.8 s** | 8 × 55 KB |
| linear.app | 9,619 px | 5.0 s | **8.3 s** | 8 × 40 KB |

About ten seconds per page, once, at one width. `capture_reference` already spends more than that per
page across four widths.

Fed to the model at 480 px wide, eight checkpoints cost roughly **1,500 tokens** — against the
1.6-million-token turns this repo measured before the caching work. It is not a rounding error, but
it is close to one.

## The proposal

Three capabilities, in the order they are worth having.

### 1. A motion pass — `read_motion`

Walk the page a screenful at a time, pausing long enough for what that position triggers to actually
run, sampling `document.getAnimations()` at every stop. Group the result by signature and report the
system, not the instances:

```
Reveal:     420ms  transform+opacity   ×164   (scroll-triggered)
Emphasis:  1500ms  cubic-bezier(.455,.03,.515,.955)  opacity  ×3
Ambient:   2000ms  background-position  loop  ×2
Header:    sticky, background becomes opaque past 80px
```

Written to `clone/<host>/reference/<page>/motion.json` alongside the geometry that is already there,
and summarised into the tool's text output. This is the piece the replica skill is already asking
for, and it is the cheapest of the three.

Two details that decide whether the data is any good: easing must be read from the keyframes as well
as the effect, because per-keyframe easing reports as `linear` at the effect level; and Linear's
springs arrive as a 700-character `linear(0 0%, 0.0411 3.44%, …)` string, which must be recognised
and named rather than carried verbatim into the model's context.

### 2. Let the agent see — scroll checkpoints as images

Return the checkpoint frames to the model as `images`, exactly as `view_preview` already does. Eight
frames, 480 px wide, is the difference between the agent reading a description of a page and looking
at it.

This is the smallest change in the whole document — the plumbing exists and is already used — and it
is probably the largest single improvement to clone quality, because it closes the asymmetry: the
agent would be able to compare what it built against what it saw, instead of against a manifest.

### 3. Media — `read_media`

Per `<video>` and `<audio>`: role, metadata, and three sampled frames via `page.screenshot({ clip })`.
Enough for the agent to know it is looking at a silent looping background rather than a play button,
and to reproduce the right one.

### What not to do

**Not a video recording of the page.** Playwright can record the context to `.webm`, but the model
cannot watch a video — it would be an artifact nobody opens. Sampled frames plus a timing table is
strictly more useful and far smaller.

**Not raw `getAnimations()` dumps.** 189 rows of near-identical JSON in the model's context is the
kind of thing the token work in this repo spent a month removing. The grouping is not a nicety, it is
the feature.

**Not a full second capture pass.** The motion walk runs at one width, once per page, inside the
existing `capture_reference` navigation. Doing it per width would quadruple the cost to learn the
same easing curve four times.

## Risks

**It will find motion on pages that have none worth copying.** Cookie banners, carousels and ad
slots all animate. The grouping helps — a one-off is visibly a one-off next to a signature used 164
times — but the summary has to lead with frequency, or the agent will faithfully reproduce a cookie
banner's fade.

**Ten seconds a page adds up on a crawl.** At the default page cap this is minutes, not seconds. The
walk should be capped by stop count rather than page height, which is what the measurement above
already does at eight.

**Seeing the page could make the agent copy it too literally.** Today it works from structure, which
is part of why clones come out clean. Pixels invite pixel-matching. The checkpoints are reference,
not target — the diff loop against the built preview already exists and should stay the thing that
measures fidelity.

**Autoplay and cross-origin media.** Playing video requires a launch flag, and some of it will not
play at all behind DRM or a paywall. That must degrade to metadata-only rather than failing the
capture, the same way asset fetch failures already degrade.

## What I would build first

1. **`read_motion`**, with the grouping and the easing/spring handling. It is self-contained, it is
   the thing the skill is already asking for, and it can be verified against the numbers in this
   document.
2. **Checkpoint images returned to the model.** Small, and it removes the asymmetry that the agent
   can see its own work but never the reference.
3. **`read_media`** last. It matters on fewer sites, and it is the only one of the three with a real
   failure mode to design around.

Then wire all three into `capture_reference` so `/clone` gets them without being asked, and update
`motion-scroll-and-time.md` so the skill asks for evidence that now exists.

## What was built

| | |
|---|---|
| `packages/tools/src/page-walk.ts` | the walk, the grouping, the media and pinned-layer reading |
| `packages/tools/src/browse-page.ts` | `browse_page`, on any URL, behind the clone path's SSRF guard |
| `packages/tools/src/capture-reference.ts` | `/clone` runs the walk on every page and writes `motion.json` |
| `skills/complete-replica-engineering/references/motion-scroll-and-time.md` | now points at evidence that exists |

At the widest width the walk **replaces** the old lazy-load flick rather than running beside it: it
scrolls the same page, just pausing long enough to see. Every other width is untouched, and the
settled screenshot is still taken exactly as before.

`/clone` returns the entry page's frames as images, so the model can look at what it is copying. Six
frames, entry page only — not a filmstrip of the whole crawl.

### Three things only building it turned up

**Sampling twice per stop counts the same animation twice, and a loop gets counted at every stop.**
linear.app came back reporting 6,126 animations. Node cannot tell one `Animation` object from
another across `evaluate` calls, so the sampler now keeps a `WeakSet` on the page itself and reports
only what it has not seen before. 6,126 → 557, which is the real number.

**Grouping on the exact delay explodes a stagger.** A stagger *is* a delay ladder — 160ms, 162ms,
164ms across fifty elements — so grouping on it turned linear.app's one reveal into fifty
near-identical rows and buried the finding under its own evidence. Delay is now a spread, and the
whole reveal is one line:

```
×438  420ms cubic-bezier(0.25, 0.46, 0.45, 0.94) → transform + opacity, staggered 0–326ms
```

**Frequency alone ranks the decoration first.** linear.app's most-used animation is a hundred
looping circles in a particle field, which is the least useful thing on the page to copy. One-shots
now sort above loops and the summary labels them: *transitions and reveals — this is the system to
reproduce*, then *ambient loops — decoration, reproduce last*.

A fourth was a mistake in the other direction: the first version only reported a pinned layer if its
own computed style changed further down the page, and so reported nothing for real sticky headers,
because tailwindcss.com's bar changes on an inner element. That a 57px bar is pinned over the content
is the fact a clone needs first; the state change is the refinement.

### Measured after

| | Before | After |
|---|---|---|
| stripe.com | 3 animations, none recorded anywhere | 145 animations, 27 distinct |
| linear.app | — | 557 animations, 16 distinct, one dominant reveal |
| Summary size | — | 14 lines, `motion.json` 5.5 KB |

Easing improved as a side effect of reading the keyframes as well as the effect: the same motions
that reported `linear` from a naive sample come back as `ease-out`, `ease-in-out` and real cubic
béziers — the authored curves, which are the ones worth copying.
