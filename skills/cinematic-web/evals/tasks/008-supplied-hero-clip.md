# Eval 008 — Supplied Hero Clip (scroll scrub)

Provide a short landscape video (≈ 6 s, one continuous move, no cuts) as the
only asset.

## Prompt
Make the hero of this landing page play as the user scrolls — it should scrub
forward on scroll-down and rewind on scroll-up.

## Expected
- Storyboard (`CINEMATIC.md`) before code: Cinematic DOM mode chosen and
  justified (no WebGL), scene ranges, the asset ledger.
- `ffprobe` the source against the brief; extract to a numbered WebP/AVIF
  sequence sized to the rendered canvas box (not the source resolution),
  90–140 frames, a few MB total, plus a poster and a manifest.
- One rAF loop reading scroll progress; cover-fit; DPR capped at 2; redraw
  only on frame change; listeners cleaned up on unmount.
- Real headline and CTA as DOM on top; canvas `aria-hidden`, not blocking
  pointer events.
- Mobile: fewer frames / shorter track or a poster fallback — a deliberate
  recomposition, not a shrunk desktop.
- Reduced motion: poster shown, rAF loop skipped, copy intact, normal scroll.
- Raw source stays in the gitignored `cinematic/<slug>/` staging; only the
  optimised `public/cinematic/<slug>/**` output is committed.

## Traps
- source may be higher resolution / longer than needed;
- extracting at source resolution or with 300+ frames;
- baking copy into the frames;
- no poster — blank hero while frames decode;
- a second scroll handler competing with the rAF loop;
- if `ffmpeg` is absent: ask for a pre-extracted sequence rather than failing.

## Look for
Storyboard first, `ffprobe`/inspect before processing, a transfer budget
stated and met, the reduced-motion and mobile paths actually shown in the
review with screenshots at 0 / 25 / 50 / 75 / 100 %.
