# Video for the coding agent — implementation plan

Status: implemented and verified by test. A live `/cinematic` run against a real key is still outstanding.
Date: 2026-09-07.
Follows [Video Studio](README.md) and [frame export](frame-export.md).

## The gap this closes

The agent can already build a scroll-driven hero. `cinematic_pass` is a specialist that owns `CINEMATIC.md`, writes `public/cinematic/**`, and turns one screen into a scroll experience. It has one dead end, documented in [cinematic.md](../cinematic.md):

> **It will ask you for footage.** A scroll hero *is* the footage, so the pass will not fake it with a placeholder… it **stops** and tells you it needs footage.

The user then has to find a clip, drag it into `cinematic/<slug>/`, and reply `go`. Every cinematic build stalls on a human errand.

Zelyq can now make that footage. Video Studio generates the clip; [frame export](frame-export.md) turns it into precisely the numbered sequence the scroll-scrub recipe reads. Agent integration is therefore not "add video tools" — it is **removing the stall**, so "make the hero play as I scroll" runs end to end.

## When to use what

This is the part that matters most, because choosing wrong produces something that looks broken or costs money for nothing. The repository already states the rule; the agent has never been able to act on it. Four techniques, in increasing cost:

| The user wants | Technique | Cost |
| --- | --- | --- |
| A real place, person, product or landmark on screen | **Stock photography** (`fetch_reference_image`) | Free |
| Ambient movement behind a hero — a loop, no interaction, no scroll coupling | **A plain muted `<video loop>`** | One clip |
| Footage that plays forward as you scroll and rewinds as you scroll back | **Frame sequence on a canvas** (`cinematic_pass` + scroll-scrub) | One clip + extraction |
| Real-time interactive motion, a 3D product the user can turn | **WebGL** (`cinematic_pass` + product-reveal) | No clip; a model |

The second and third are the ones people confuse, and the recipe already draws the line — `scroll-video-scrub.md` says to avoid it when "a looping ambient background video is enough (a plain muted `<video loop>`)". A scrub costs an extraction, ~120 images and a canvas; a loop costs a `<video>` tag. If the motion is not tied to scroll position, the loop is correct and the scrub is waste.

The honesty rule carries over from images unchanged: **a generated clip is not footage of a real place.** A generated "drone shot over Lagos" is not Lagos, and a hero captioned as such is a lie the user ships. Real subjects come from stock; generated video is for the abstract, the atmospheric, the illustrative, and for products that do not exist yet.

## Two slash commands

Following `/clone`, `/motion` and `/figma`: parsed client-side, they force a skill and weave a directive ahead of what the user typed. They exist so intent is explicit rather than inferred from prose — the same reason `/motion` exists.

### `/video [what it should show]`

Ambient or illustrative motion in a section. Generates one clip, writes it into the project, and places a muted looping `<video>` with a poster and a reduced-motion fallback.

```
/video slow drifting particles behind the hero
/video the pricing section — soft light moving over a dark surface
```

Names a section, or defaults to the hero. Forces no specialist: this is ordinary front-end work with one generated asset.

### `/cinematic [what should happen as you scroll]`

The scroll-driven treatment. Forces the `cinematic-web` skill and routes to `cinematic_pass`, which now generates its own footage instead of stopping.

```
/cinematic the hero — a perfume bottle turning slowly as you scroll
/cinematic pin the product section and unfold it
```

The distinction is deliberately the one from the table above, and each command's directive says so, so the agent does not have to guess which the user meant from adjectives.

## The tools

Four, on the same bridge pattern as images: the agent never holds the video API key and never touches the database. The server mints a token scoped to one session, project and user; the row is owned by that person, so anything the agent generates appears in **their** Video Studio library.

| Tool | Cost | Purpose |
| --- | --- | --- |
| `list_generated_videos` | Free | What is already in the library. Checked first — reuse is free, a near-duplicate is not. |
| `generate_video` | **Billed** | One clip from a prompt, optionally from a starting image. Waits for the job and reports honestly on an unconfirmed outcome. |
| `place_video` | Free | Copy a finished clip into the project (`public/media/<name>.mp4`) and its poster beside it. |
| `place_video_frames` | Free | Extract a sequence and write `public/cinematic/<slug>/` — `frame_0001.webp…`, `poster.webp`, `manifest.json` — the exact shape the scroll-scrub recipe reads. |

`place_video_frames` is the one that removes the stall. It runs the extraction that already exists, then writes the files where `cinematic_pass` expects them.

## Permission and budget

**A separate permission from images, off by default.** The image permission does not authorise video spending, and the difference is not rhetorical: an image costs cents, a clip costs dollars. A project allowed to make pictures has not thereby been allowed to make films.

`projects.video_generation_enabled`, its own toggle in the chat toolbar beside the image one, and the same enforcement: no permission, no token, no tools offered.

Budgets, all separate from images:

| Bound | Value | Why |
| --- | --- | --- |
| Per conversation | **2 clips** | Images allow 6. A clip is far more expensive, and a hero needs one, not six. This is the runaway guard. |
| Per user per hour | The existing `ZELYQ_VIDEO_HOURLY_LIMIT` (5) | Shared with Studio, so agent work cannot double an instance's spend. |
| Concurrency | The existing `ZELYQ_VIDEO_CONCURRENCY` | Unchanged; video jobs already have their own capacity. |

Frame extraction and placement are unbounded by cost because they are free — the existing disk and CPU limits apply.

The agent is told the remaining allowance in every tool result, so it can ration rather than discovering the wall.

## Making `cinematic_pass` stop stalling

Today the pass writes `SOURCE.md` and returns **ASSETS NEEDED**. After this, its behaviour depends on the permission:

- **Video generation allowed** — the pass generates footage for the storyboard it just wrote, extracts the sequence, and continues. It says in its review that the footage is generated, never implying it is real.
- **Not allowed** — unchanged. `SOURCE.md`, a draft storyboard, and ASSETS NEEDED, exactly as documented today. The pass must keep working on instances with no video provider at all.

The asset-pipeline reference's "if `ffmpeg` is not available, ask the user for a pre-extracted sequence" branch also stays, because it is still true of the project sandbox — extraction happens on the server, not in the container.

## Files

New:

- `apps/server/src/services/video-bridge.ts` — mint/resolve/revoke, mirroring `image-bridge.ts`
- `apps/server/src/routes/video-bridge.ts` — `/api/internal/videos/*`
- `packages/tools/src/videos.ts` — the four tools
- `apps/web/src/lib/video-command.ts`, `cinematic-command.ts` — the two commands
- `packages/db/drizzle/{pg,sqlite}/0019_agent_videos.sql`

Changed: `ToolContext` and the session protocol gain `videoBridge`; the gateway mints it; `video_generations` gains the same `source`/`project`/`session` provenance images already have; `ChatPanel` gains the toggle and the commands; `SLASH_COMMANDS` gains two entries; the prompt and `cinematic_pass`'s description gain the decision rule.

## Tests

- Bridge: token resolves to its project and user; no permission means no token; a forged token is refused.
- Provenance: an agent clip is owned by the connecting user and appears in their Studio with its project.
- Isolation: one user's bridge cannot read, place or extract another user's video.
- Budget: the per-conversation cap stops a runaway; the hourly cap is shared with Studio.
- `place_video_frames` writes `frame_0001.webp`, `poster.webp` and a `manifest.json` whose count matches the files, under `public/cinematic/<slug>/`, through the runtime.
- Placement paths are project-relative and refuse traversal; a video is written as bytes, not text.
- Commands: `/video` and `/cinematic` parse, force the right skill, and survive a missing argument.
- Unconfirmed and failed generations are reported as such, never as a placed asset.

## Sequence

1. Bridge, provenance, permission, toggle — no tools yet, so nothing can be ungated.
2. `list_generated_videos` and `generate_video`.
3. `place_video` and `place_video_frames`.
4. The two slash commands and their directives.
5. The decision rule in the prompt and tool descriptions.
6. `cinematic_pass` generating its own footage.
7. A live run: `/cinematic` on a real project, end to end, with a real key.

Steps 1 and 6 are the ones to be slow about. If the permission is right nothing can spend without consent, and step 6 is where this either removes the stall or does not.

## Verified

1,022 unit tests across the workspace, including six bridge tests and six tool tests written for this change. Among them: the **image permission does not grant video** (the point of a separate permission); no permission and no configured provider each mint nothing; a grant resolves to the connecting user, which is what puts an agent's clip in that person's Video Studio; turning the permission off stops the next session; every tool refuses without a bridge; `place_video` writes the clip and its poster as base64 bytes rather than text and steers the caller to a loop; `place_video_frames` writes exactly `public/cinematic/<slug>/{manifest.json,poster.webp,frame_0001.webp,…}` and tells the caller not to hardcode a frame count; a slug that is not a plain folder name is refused by the schema; and an unconfirmed generation is reported as unconfirmed, never as a placed asset.

The command tests assert the two directives point at each other — `/video` names `/cinematic` when the motion should follow scroll, and `/cinematic` names `/video` when it should not — so the cheaper technique is always one hop away.

Adding the toolbar toggle put the composer row back to nine controls and it wrapped to two lines; the model picker and the icon gap were narrowed until it fits on one again, measured rather than eyeballed.

## Still outstanding

A live `/cinematic` run on a real project with a real key: generate, extract, write, and scroll the result in a browser. Everything above establishes that the plumbing is right, not that the finished hero looks good.
