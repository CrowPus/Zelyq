# 3D Asset Pipeline

## Runtime format

Prefer glTF 2.0 / GLB for normal web-delivered 3D assets unless the project has a strong reason otherwise.

## Inspect first

Run:

```bash
scripts/inspect-glb path/to/model.glb
```

Inspect:
- transfer size;
- mesh/primitive count;
- vertices/triangles;
- material count;
- texture dimensions and formats;
- animation clips;
- unused data;
- compression extensions.

Optimization is diagnostic, not ritual.

## Geometry compression

### Meshopt
Useful general-purpose compression for glTF geometry and related data.

### Draco
Can significantly reduce geometry transfer size but introduces decode cost on the client.

Smaller bytes do not automatically mean faster user experience.

## Textures

Textures often dominate runtime GPU memory.

Check:
- unjustified 4K/8K maps;
- duplicate maps;
- oversized alpha textures;
- unnecessarily large normal/roughness maps;
- lack of GPU-friendly compression.

KTX2/Basis Universal can reduce texture memory/transfer pressure and is supported in Three.js via `KTX2Loader`.

## Suggested pipeline

1. Preserve the untouched source.
2. Export a web GLB.
3. Inspect.
4. Prune unused data.
5. Deduplicate.
6. Resize oversized textures.
7. Choose geometry compression if beneficial.
8. Choose texture compression if beneficial.
9. Inspect again.
10. visually compare.
11. test target devices.

`gltf-transform optimize` is a useful baseline, but high-value assets may need a custom pipeline.

## Animation

Remove unused clips and unnecessary keyframes when possible. Verify skeletons, morphs, and clips after optimization.

## Loading

- preload only high-priority hero assets;
- lazy-load later scenes;
- preserve meaningful HTML fallback;
- never block all page content on decorative 3D.

## Disposal

Three.js GPU resources are not automatically freed just because JavaScript references disappear.

When a resource truly becomes obsolete, consider disposing:
- geometry;
- material;
- texture;
- render target;
- skeleton where appropriate.

Do not dispose shared resources still in use.

## Commands

```bash
scripts/inspect-glb public/models/product.glb
scripts/optimize-glb public/models/product.glb public/models/product.optimized.glb
```

---

## Frame sequences for scroll-scrub (2D)

For the `scroll-video-scrub` recipe — a supplied clip painted frame by frame
onto a DOM canvas as scroll progresses — the "asset" is a numbered image
sequence, not a GLB. Treat it with the same "inspect first, optimise to a
budget" discipline.

### Inspect the source first

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,codec_name,nb_frames \
  -show_entries format=duration -of default=noprint_wrappers=1 source.mp4
```

Check: duration (3–8 s is the target — the whole clip plays across one screen
of scroll), dimensions (downscale anything over ~2160 wide), frame rate
(25–30), and that it is one continuous move with no hard cuts.

### Extract

```bash
# ~120 frames from a 5 s clip → 24 fps; scale to the RENDERED box, not the source
ffmpeg -i source.mp4 -vf "fps=24,scale=1600:-2:flags=lanczos" \
  -q:v 5 public/cinematic/<slug>/frame_%04d.webp
```

- Target **90–140 frames**. `fps = frames / duration`. More frames = smoother
  scrub but linear transfer cost.
- Size to the **largest canvas box the layout renders**, capped ~1600–1920
  wide. The canvas cover-fits; extra pixels are wasted bytes.
- **WebP** (`-q:v 4–6`) is the safe default; **AVIF**
  (`-c:v libaom-av1 -crf 34 -b:v 0 -cpu-used 6`) is smaller but slower to
  encode and decode — measure decode on a mid device before choosing it.
- Keep total transfer to **a few MB**. If it won't fit, cut frame count or
  dimensions before you cut quality per frame.

### Poster + manifest

```bash
# a poster for first paint and the reduced-motion path
cp public/cinematic/<slug>/frame_0001.webp public/cinematic/<slug>/poster.webp
```

Write a small `manifest.json` next to the frames so the component does not
hard-code the count:

```json
{ "slug": "hero", "count": 120, "width": 1600, "height": 900,
  "frames": ["frame_0001.webp", "…"], "poster": "poster.webp", "fps": 24 }
```

### If `ffmpeg` is not available

The default sandbox ships no `ffmpeg`/`ffprobe`. Probe first
(`ffmpeg -version`). If absent, ask the user for a **pre-extracted numbered
sequence** (or an already-optimised `.webm` + poster) in `SOURCE.md`, and use
the image-asset tools (`resize_image_asset` / `optimize_image_asset`) to bring
the supplied frames to size and format. Record which path was taken in the
review.

### Failure modes

- extracting at source resolution — 4K frames for an 800px canvas;
- too many frames (300+) for a 5 s clip — transfer bloat, no visible benefit;
- a `.gif` source — huge and 8-bit; always ask for MP4/WebM or a sequence;
- no poster — a blank hero while dozens of images decode;
- committing the raw source into `public/` — only the optimised output ships;
  the raw drop stays in the gitignored repo-root `cinematic/<slug>/` staging.

## Sources

- https://www.khronos.org/gltf/
- https://gltf-transform.dev/
- https://threejs.org/docs/pages/GLTFLoader.html
- https://threejs.org/docs/pages/DRACOLoader.html
- https://threejs.org/docs/pages/KTX2Loader.html
- https://threejs.org/manual/en/how-to-dispose-of-objects.html
