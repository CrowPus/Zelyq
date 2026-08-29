# Cinematic scroll experiences

Zelyq can turn one screen into a **scroll-driven film** — a hero that plays
frame by frame as you scroll down and rewinds as you scroll up, a pinned
product reveal, a horizontal story. This is the work a design studio charges
thousands for; the **Cinematic engineer** does it as a pass you watch run.

## How to trigger it

In **Engineer Mode** (the hard-hat button), ask for it in plain terms:

- *"make the hero play as I scroll"*
- *"Apple-style scroll animation on the landing page"*
- *"scrollytelling for the /product page"*
- *"pin the hero and animate it as I scroll"*

The Engineer hands that one screen to the Cinematic engineer. It is not part
of the automatic Architect build — you trigger it, on one screen at a time.

## It will ask you for footage

A scroll hero *is* the footage, so the pass will not fake it with a
placeholder. The first time you ask, it:

1. looks at the screen and works out what footage the effect needs;
2. creates a folder in your project — **`cinematic/<name>/`** — with a file
   called **`SOURCE.md`**;
3. writes a first draft of the storyboard (`CINEMATIC.md`);
4. **stops** and tells you it needs footage.

`SOURCE.md` is a plain-language checklist. For a scroll hero it asks for
roughly:

- a short video (MP4 or WebM), a GIF, or a numbered image sequence;
- **3–8 seconds**, one continuous move (an orbit, a slow push in, an
  unfold) — no cuts;
- your subject centred with headroom for the headline;
- about **1920×1080**, 25–30 fps;
- name it `source.<ext>`.

## What you do

Put your file into the **`cinematic/<name>/`** folder the pass created — drag
it in through the file tree, or drop it into your workspace folder — and
reply:

```
go
```

The pass picks up from the storyboard it already wrote. It checks your file
against `SOURCE.md`; if it is the wrong shape (portrait when it needed
landscape, 40 seconds when it asked for 8), it tells you exactly what to
swap — or you can tell it to adapt the storyboard to what you gave it.

With a good file it extracts and optimises the frames, builds the scroll
component, wires it into the screen, and hands back a **CINEMATIC REVIEW**
with screenshots at 0 / 25 / 50 / 75 / 100 % scroll, the mobile version, and
the reduced-motion version.

## What ships, what doesn't

- Your **raw file stays out of git** — it lives in `cinematic/<name>/`,
  which is ignored.
- Only the **optimised frames** (a few MB, in `public/cinematic/<name>/`)
  are committed and shipped.

## What it will and won't do

- **Will:** one screen, one scroll experience — the component, the frames,
  the mobile recomposition, the reduced-motion fallback, and `CINEMATIC.md`.
- **Won't:** add features, routes, or pages; touch the server, the database,
  or your build config; run a 3D engine when a plain canvas does the job.

## Steering it

Open **`CINEMATIC.md`** after a pass. It holds the storyboard — the scenes,
their scroll ranges, the asset list. Edit it and the next cinematic pass
builds to your version.

## If it says it can't process video

Some Zelyq setups don't ship `ffmpeg` in the build sandbox. In that case
`SOURCE.md` asks you for a **pre-extracted image sequence** (or an
already-optimised `.webm` plus a poster image) instead of a raw video, and
the pass resizes those to fit. The review tells you which path it took. An
operator can enable raw-video processing — see
[self-hosting.md](./self-hosting.md).

## See also

- [modes.md](./modes.md) — all the specialist agents and when they run.
- The `cinematic-web` skill under `skills/` is the craft the pass is built
  to (rendering modes, scroll choreography, the asset pipeline, the quality
  gate).
