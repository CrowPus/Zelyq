# Frame export — splitting a clip into an image sequence

Status: implemented and verified by test.
Date: 2026-09-07.
Extends [Video Studio](README.md).

## Why this exists

A scroll-scrubbed hero — the "video plays as you scroll" effect — is not a `<video>` element. It is a numbered image sequence painted onto a canvas, one frame per scroll position. The repository already knows how to build that: [`scroll-video-scrub.md`](../../skills/cinematic-web/recipes/scroll-video-scrub.md) is the recipe, and [`asset-pipeline.md`](../../skills/cinematic-web/references/asset-pipeline.md) specifies the assets it consumes.

That reference also records the gap this closes:

> The default sandbox ships no `ffmpeg`/`ffprobe`. Probe first. If absent, ask the user for a **pre-extracted numbered sequence**.

So today the effect is only reachable if somebody extracts frames by hand outside Zelyq. Video Studio already holds the clip and already ships a packaged `ffprobe`; extracting the sequence belongs here. Once the agent gets video tools, "make the hero scrub as I scroll" becomes something it can actually do end to end.

## The output contract

Not invented here — this is exactly what the existing recipe reads, so the two halves fit without a translation step:

```
frames/
  frame_0001.webp … frame_0120.webp    1-indexed, four digits
  poster.webp                          first frame; first paint + reduced motion
  manifest.json
```

```json
{ "slug": "hero", "count": 120, "width": 1600, "height": 900,
  "frames": ["frame_0001.webp", "…"], "poster": "poster.webp", "fps": 24 }
```

The manifest exists so a component never hard-codes a frame count. The poster exists because the recipe's first failure mode is "a blank hero until dozens of images decode", and its reduced-motion path shows a still.

## Extraction

`ffmpeg-static`, added as a dependency the same way `ffprobe-static` already is — the design's own rule is to package a media binary rather than assume the host has one. Invoked with the same guards the existing probe uses: no network protocols, a timeout, bounded output, `windowsHide`.

```
ffmpeg -v error -protocol_whitelist file -i <clip>
       -vf "fps=<count/duration>,scale=<width>:-2:flags=lanczos"
       -c:v libwebp -q:v <quality> -f image2 frame_%04d.webp
```

Two flags are load-bearing and were found by running it, not by reading docs:

- **`-c:v libwebp`.** Left to itself ffmpeg picks `libwebp_anim` and writes **one animated WebP** instead of a sequence — a silent wrong answer, not an error. Measured: 1 file instead of 24.
- **`-f image2`.** Forces the image-sequence muxer rather than letting the `.webp` extension select a single-file muxer.

`-vf scale=W:-2` keeps the aspect ratio and forces an even height, which the encoders require.

## Controls, and their defaults

| Control | Default | Bounds | Why |
| --- | --- | --- | --- |
| Format | `webp` | `webp`, `jpeg`, `png`, `avif` | The recipe's asset budget calls WebP the safe default. AVIF is offered because this ffmpeg build has `libaom-av1`, but it is slow to encode and decode — the reference says measure before choosing it. PNG is lossless and large; it is for pipelines that will process the frames further, not for shipping. |
| Frame count | 120 | 8–240 | The recipe targets 90–140. `fps = count / duration`, exactly as the pipeline reference computes it. Below ~90 the scrub visibly steps; above ~140 is transfer cost with no visible gain. |
| Width | 1600 | 320–1920 | "Size to the largest canvas box the layout renders, capped ~1600–1920." Extracting at source resolution is the reference's first listed failure. |
| Quality | per format | — | WebP `q:v 75`, JPEG `q:v 3`, AVIF `crf 34`. PNG ignores it. |

Height is always derived from the source aspect ratio; there is no independent height control, because a mismatched one would distort the frame and the canvas cover-fits anyway.

## Limits

Frame sets are cheap to make and easy to make enormous — 240 frames at 1920 is a plausible accident. So:

- One extraction at a time per user; a second is refused while one runs.
- A hard 120-second ffmpeg timeout, and the process is killed on it.
- At most 240 frames and 1920 pixels wide, enforced before ffmpeg is invoked.
- A 250 MiB ceiling on a set; extraction that exceeds it is discarded rather than half-kept.
- Set bytes count against the user's existing video storage budget. Frames are not a loophole around the 5 GiB cap.
- **One set per video.** Re-extracting replaces the previous set rather than accumulating. This keeps storage bounded by the library cap that already exists, and matches how people actually use it: you try 90 frames, look at it, and try 140.

No provider is involved and nothing is billed, so there is no hourly cap — the limits here are about disk and CPU.

## HTTP

| Endpoint | Purpose |
| --- | --- |
| `POST /api/videos/generations/:id/frames` | Extract, replacing any existing set. Returns the set. |
| `GET /api/videos/generations/:id/frames` | The set's metadata, or 404. |
| `GET /api/videos/generations/:id/frames/:name` | One file: a frame, the poster, or `manifest.json`. |
| `GET /api/videos/generations/:id/frames.zip` | The whole set as one download. |
| `DELETE /api/videos/generations/:id/frames` | Remove the set and reclaim its bytes. |

Every route is owner-scoped like the rest of Video Studio. `:name` is matched against a strict pattern — `frame_%04d.<ext>`, `poster.<ext>`, or `manifest.json` — and never used to build a path from user input.

The ZIP is written **store-only, no compression**: WebP, JPEG, AVIF and PNG are already compressed, so deflating them costs CPU to save nothing. That also keeps the writer small enough to be obviously correct rather than a dependency.

## Persistence

One migration, `0018_video_frames`, both dialects, with a parity test. A `video_frame_sets` table keyed by generation — one row per video, so the key *is* the generation id:

| Column | Purpose |
| --- | --- |
| `generation_id` | Primary key; the video these frames came from |
| `owner_id` | The owner, so every query stays owner-scoped without a join |
| `format`, `count`, `width`, `height`, `fps` | What was produced, for the manifest and the UI |
| `size_bytes` | Storage accounting |
| `created_at` | When |

Files live beside the clip under `ZELYQ_VIDEO_ASSETS_DIR`, in `<vid>.frames/`. Deleting the video deletes its frames; deleting the account deletes both.

## What this is not

Not a video editor. No trimming, no ranges, no cuts, no re-encoding to another video format, no sprite sheets. Splitting one clip into the sequence a scroll-scrub needs is a complete job on its own, and every one of those is a separate decision with its own controls.

## Library posters

Packaging `ffmpeg` for frame export also made a video's own thumbnail possible, so `GET /api/videos/assets/:id/poster` now serves one: a single WebP still, 640 wide, taken from the **middle** of the clip. Before this, a text-to-video result had nothing to show in the library and rendered a grey film icon; only image-to-video had a picture, and that was its input rather than its output.

The mid-point is chosen on purpose. An opening frame is frequently a fade from black, so posters taken from frame one make every card look identical. That differs from the frame *set's* poster, which stays `frame_0001` because there it has to match the first thing the scroll-scrub canvas paints.

It is generated on first request and then kept, which means clips made before posters existed get one as soon as they are displayed — no backfill, no migration. Concurrent viewers of the same card share one in-flight extraction rather than each running ffmpeg.

## The agent, later

This is deliberately built as a user feature first, exactly as Video Studio was. When video reaches the agent it will want two things: extract a set, and write it into a project at `public/cinematic/<slug>/`. Both are then thin calls over the same bridge, and the output already matches what `scroll-video-scrub.md` reads. No agent tool is added here.

## Verified

Seven server tests and the Video Studio browser test cover this. Among them: the output is a real numbered sequence rather than one animated file (each frame's bytes are checked for a WebP signature); each format produces its own extension and media type; re-extracting replaces the previous set and its files are actually gone; the ZIP's central directory parses and every entry is stored rather than deflated; another user cannot read the set, a frame, or the archive; a name outside the permitted shapes does not resolve; deleting the video takes its frames off disk; and counts, widths, formats and unknown fields outside the contract are refused.

The ZIP writer was additionally checked against Python's `zipfile` — CRC integrity passes and the extracted bytes are identical to the source frames.

## Not settings

The bounds here are constants, not operator settings, unlike the video limits. Nothing is billed, so there is no spending decision for an operator to make; the numbers exist to stop one request eating the disk or a core, and the values that matter to a user — format, count, width — are already in the request. If an operator ever needs to move them, that is a reason to add settings then, with a case for the number.
