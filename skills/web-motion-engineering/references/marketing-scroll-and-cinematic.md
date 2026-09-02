# Marketing, scroll, and cinematic motion

Use this reference for landing pages, product launches, scroll stories, frame sequences, video-backed heroes, canvas, shaders, and 3D.

## Start with a static storyboard

Define 4–7 decisive frames, each with:

- the claim the user is reading;
- the subject and camera/viewport relationship;
- what changes from the previous beat;
- the user-controlled or time-controlled trigger;
- a stable composition for mobile;
- the reduced/static frame;
- the loading placeholder and final fallback.

If the sequence cannot be explained as frames, its choreography is not yet clear.

## Scroll behavior

- Native scroll remains authoritative. Do not hijack wheel/touch behavior or disable expected browser navigation.
- Use scrubbing when scroll position represents progress through one transformation. Use simple in-view triggers for independent sections.
- Pin only while the pinned scene earns the vertical distance. Keep text progression obvious and allow users to leave the scene naturally.
- Scroll-linked motion should move both forward and backward correctly.
- Avoid forced scroll snapping for long reading pages. If snapping is essential, test touch momentum, keyboard, trackpad, zoom, and reduced motion.
- Parallax is optional and high-risk for vestibular sensitivity. Keep amplitude low, avoid moving large backgrounds, and remove it in the reduced branch.

## Choose the visual renderer

| Story need | Preferred medium |
| --- | --- |
| DOM cards/UI assembling into a workflow | DOM + CSS/Motion/GSAP |
| Clean lines, paths, logo construction | SVG |
| Photoreal object transforming along one known path | Video or frame sequence |
| User-controlled product rotation/configuration | 3D/WebGL |
| Particles, fluid fields, shader transitions | Canvas/WebGL with strict performance fallback |
| Small authored illustration loop | Rive/Lottie or optimized video if cheaper |

Do not use 3D merely to qualify the page as premium. Premium motion comes from art direction, pacing, typography, continuity, and restraint.

## Layer architecture

A reliable cinematic section often has:

1. semantic DOM content and controls;
2. a sticky visual stage sized independently from document flow;
3. a progress model mapping scroll ranges to named story beats;
4. one renderer (DOM, canvas, video, or WebGL) driven from that progress;
5. a reduced/mobile/static branch sharing the same content.

Keep the canvas decorative (`aria-hidden`) unless it is a real interactive control. Never duplicate the same readable text inside canvas and DOM.

## Frame sequences and video

- Preload only the opening/poster frame immediately; fetch the rest according to visibility and network conditions.
- Decode ahead of display when supported, but cap concurrency and memory.
- Reserve aspect ratio and show a meaningful poster while loading.
- Map scroll progress to frames without React state on every tick.
- Skip redundant draws when the resolved frame number has not changed.
- Provide an image/static composition on mobile or reduced motion when the full sequence is too costly.
- Avoid shipping hundreds of full-resolution images when a well-encoded video can deliver equivalent control/quality.

## WebGL/3D

- Use glTF assets; compress geometry/textures where the chosen pipeline supports it.
- Reuse geometry/material instances and reduce draw calls.
- Cap device pixel ratio; high-DPR phones do not need desktop-quality rasterization.
- Render on demand for static scenes. Pause the loop offscreen or when the document is hidden.
- Avoid expensive real-time shadows, post-processing stacks, and transparent overdraw unless the visual benefit survives profiling.
- Dispose GPU resources when scenes change.
- Provide a poster or DOM composition for no-WebGL, failed asset load, reduced motion, and constrained mobile paths.

## Text and conversion

- The headline and CTA reach a readable, stable state quickly.
- Do not make users scroll through spectacle before understanding the product.
- Keep body copy stationary while users read; avoid continuous background motion behind dense text.
- Motion should reveal proof: product UI, workflow, outcome, metric, or demonstration—not only abstract particles.
- The final CTA remains visible and clickable without timing a click between moving layers.

## Anti-patterns

- Every section uses opacity + `translateY(20px)`.
- Multiple unrelated objects float continuously.
- A custom cursor hides the native pointer or harms precision.
- Smooth-scroll inertia makes input feel delayed.
- Scroll pinning creates blank distance with no information change.
- Text is split character-by-character across the whole page.
- A heavy 3D asset loads before the core message.
- The mobile version is a scaled-down desktop scene instead of a recomposed scene.
