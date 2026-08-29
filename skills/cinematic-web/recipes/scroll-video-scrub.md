# Recipe: Scroll Video Scrub (DOM canvas)

## Use when
A short piece of supplied footage — an orbit, a dolly-in, an unfold, an
assembly — should play forward as the user scrolls down and rewind as they
scroll up. This is the common "the hero plays as you scroll" effect and the
default answer to it.

## Avoid when
- the motion is real-time and interactive (use WebGL — see `product-reveal.md`);
- a looping ambient background video is enough (a plain muted `<video loop>`);
- there is no footage and none is coming (do not fake it with CSS parallax and
  call it the same thing).

## Architecture
**Cinematic DOM.** No WebGL. One `<canvas>` that preloads a numbered frame
sequence and paints exactly one frame per `requestAnimationFrame`, chosen from
the scroll progress of a tall track section. Real copy is DOM on top; the
canvas is decorative.

```
<section class="track" style="height: 300vh">   <!-- scroll distance -->
  <div class="sticky">                          <!-- position: sticky; top: 0; height: 100vh -->
    <canvas aria-hidden="true"></canvas>        <!-- the scrub surface -->
    <div class="copy">…real headline, real CTA…</div>
  </div>
</section>
```

## Story
Keep it to one continuous move. A scrub across a cut reads as broken. Three
beats at most, expressed as ranges of the track:
1. **Enter** — 0–15%: the first frame holds, copy fades in.
2. **Play** — 15–85%: frames advance linearly with progress.
3. **Resolve** — 85–100%: the last frame holds, CTA settles.

## Build
1. Semantic DOM first — headline, subcopy, CTA as real elements, readable with
   the canvas removed.
2. Preload: build the frame URL list (`/cinematic/<slug>/frame_0001.webp …`
   from the manifest), `new Image()` each, count `onload`, show a poster until
   all (or the first N) are ready.
3. One `scroll`/`rAF` loop:
   - `progress = clamp(-rect.top / (rect.height - innerHeight), 0, 1)` where
     `rect` is the track's `getBoundingClientRect()`;
   - `frame = Math.min(last, Math.round(progress * last))`;
   - only redraw when `frame` changed;
   - draw cover-fit (compute scale from canvas vs. image aspect, center).
4. Backing store: `canvas.width = cssWidth * min(devicePixelRatio, 2)` — cap
   DPR at 2, re-measure on `resize`.
5. Optional: a feathered radial mask or `mix-blend-mode: screen` so the frame
   reads as light in the layout, not a video box.
6. Mobile: fewer frames, a shorter track (`h-[200vh]`), or drop to the poster
   + a short CSS transition if the sequence would blow the transfer budget —
   per `mobile-fallback.md`.
7. Reduced motion: `matchMedia("(prefers-reduced-motion: reduce)")` → skip the
   rAF loop entirely, show the poster (or the mid-point frame), keep the copy.
8. Cleanup: remove the scroll/resize listeners and cancel the rAF on unmount.

## Timeline shape

```js
const frames = manifest.frames.map((name) => {
  const img = new Image();
  img.src = `/cinematic/${slug}/${name}`;
  return img;
});
const last = frames.length - 1;
let current = -1;

function render() {
  const rect = track.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, -rect.top / (rect.height - innerHeight)));
  const frame = Math.min(last, Math.round(p * last));
  if (frame === current) return;
  current = frame;
  drawCover(ctx, frames[frame], canvas.width, canvas.height);
}

const onScroll = () => requestAnimationFrame(render);
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", resizeAndRender);
```

GSAP is not required for this shape. If a secondary DOM element (a caption, a
progress rule) must move with the same progress, drive it from the same
`render()` — do not add a second `ScrollTrigger` competing with the rAF loop.

## Asset budget
Aim for **90–140 frames**, **WebP or AVIF**, sized to the largest rendered
canvas box (not the source resolution), **a few MB total transfer**. Extract
with `ffmpeg` — see `references/asset-pipeline.md` § "Frame sequences for
scroll-scrub". Always ship a **poster** (`frame_0001` or a hand-picked frame)
for first paint and the reduced-motion path.

## Failure modes
- body copy baked into the frames (it can't be selected, translated, or read
  by a screen reader) — copy is DOM, always;
- the canvas intercepts pointer events and blocks the CTA — `pointer-events:
  none` or keep it behind the copy, and `aria-hidden`;
- no poster: a blank hero until dozens of images decode;
- redrawing every rAF even when the frame index didn't change;
- uncapped DPR: a 4K backing store on a retina laptop, jank on every frame;
- track height not accounting for `innerHeight`, so the last frame is never
  reached and the section can't scroll past;
- listeners left attached after unmount — the next route still scrubs a dead
  canvas.

## QA
Capture 0 / 10 / 25 / 50 / 75 / 90 / 100%. Then: scroll up from 100 to 0
(rewind is smooth, no skipped frames), fast-fling, drag the scrollbar, reload
at 50%, resize narrow↔wide. Reduced-motion on: the poster shows and the copy
is intact. Lighthouse: LCP is the poster or the copy, not a late frame; CLS 0.
