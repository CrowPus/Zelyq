# Editorial Transition Systems

Use this reference when a website should feel like a designed sequence rather than a stack of animated sections. It distills reusable motion decisions observed on Vero Studio and Nothin' on 2026-09-02. Treat the sites as evidence and inspiration, not templates: do not copy their identity, wording, imagery, exact composition, or proprietary assets.

## The central decision

Choose one dominant grammar.

### Continuity — luxury editorial

Continuity preserves the viewer's mental model. One subject changes scale, crop, context, or meaning while remaining perceptually connected to the previous state.

Use it when the brand must feel:
- refined, calm, tactile, intimate, timeless, or trustworthy;
- image-led rather than effect-led;
- premium without feeling technologically loud.

### Rupture — experimental studio

Rupture creates memory through controlled surprise. Layout, scale, typography, and media may break expected relationships, but every disruption is still authored and reversible.

Use it when the brand must feel:
- provocative, cultural, playful, fashion-forward, or unconventional;
- comfortable making the interface itself part of the work;
- credible enough to spend some usability budget on surprise.

### Hybrid

Use a stable continuity system for navigation, conversion, and most reading. Permit rupture inside one explicitly bounded showcase scene. Do not alternate styles every section.

## Evidence-derived pattern map

### Vero Studio: continuity through transformation

Observed structure:

1. A full-viewport portrait video opens with almost no competing interface.
2. The story moves into generous neutral space and large editorial type.
3. A small, centrally cropped image enters beneath the headline. Its `clip-path` opens while its scale grows from roughly half-size toward full viewport.
4. The image becomes a sticky, full-screen three-state sequence. Media changes while a horizontal line of type advances from dress to data to sculpture. Small position markers communicate progress.
5. The next chapter releases the full-screen scene into an asymmetric diptych: a tall left image remains sticky while smaller images and explanatory copy move on the right.
6. Navigation uses a curtain-like clip reveal. During an internal route change, the overlay collapses through an inset clip before the destination settles, preserving the same visual language as the scroll masks.

Reusable lessons:
- Reuse the same subject across scale changes to preserve identity.
- Let crop, scale, and context do most of the work; avoid decorative spins or bounce.
- Give large imagery enough scroll distance to settle before replacing it.
- Pair one active word or phrase with the active media state.
- Use restrained progress markers when a pinned scene has discrete steps.
- Alternate immersive scenes with quiet reading scenes so motion has contrast.

### Nothin': rupture through authored collisions

Observed structure:

1. A huge wordmark establishes the opening composition while a canvas masks or reveals moving media across the hero.
2. A full-width showreel gives way to an asymmetric project gallery. Images use different dimensions and subtle independent vertical offsets.
3. A cinematic scene begins oversized, filling the viewport. As scrolling continues, the video shrinks into a framed display while the surrounding museum image zooms out. A blurred reflection appears beneath the display.
4. Shiny object cutouts and separated letterforms drift, rotate, and scale at different rates across a black field.
5. A full-viewport image becomes a sticky glitch scene with repeated text fragments and deliberate character corruption.
6. Sound is treated as optional and explicitly controlled.
7. A project navigation briefly decomposes the persistent `WORKS` label, changes the page field from black to white, then reveals destination media from a fully inset clip. The route transition borrows motifs already established inside the page instead of introducing a new effect.

Reusable lessons:
- Build surprise from contrast: huge/small, clean/corrupt, flat/deep, ordered/scattered.
- Give every independent object a defined start, end, and visual role; random transforms are not art direction.
- Use one takeover scene as an event, then return to readable pacing.
- A convincing scale transformation changes both subject and environment. Scaling only the video looks like a resize, not a spatial reveal.
- Reflections, blur, filters, and canvas masks are expensive; constrain their area and duration.
- Keep navigation, calls to action, and core copy stable while expressive layers move around them.

## Select patterns from the story, not the reference

| Story need | Pattern | Grammar |
| --- | --- | --- |
| Turn an object into the next chapter | Masked image expansion | Continuity |
| Explain a three-stage process | Pinned media stepper | Continuity |
| Move from emotion to explanation | Full-screen scene into editorial diptych | Continuity |
| Make one project feel like an event | Oversized-to-framed media takeover | Rupture or hybrid |
| Present a creative portfolio | Asymmetric parallax gallery | Rupture |
| Express multiplicity or collaboration | Authored object-and-letter scatter | Rupture |
| Signal a deliberate conceptual break | Sticky glitch tableau | Rupture; use once |
| Preserve identity across routes | Curtain or shared-element route transition | Either |

## Required scene contract

Before implementation, define each major transition:

```yaml
- id: material-becomes-product
  purpose: show transformation
  grammar: continuity
  trigger: scroll
  range: 28vh-180vh
  pin: media-stage
  start:
    media: centered-crop
    copy: process-introduction
  beats:
    - source
    - analysis
    - outcome
  end:
    media: full-viewport
    next_scene: editorial-diptych
  mobile: discrete-crossfade
  reduced_motion: stacked-states
```

Reject a scene when its purpose cannot be stated without naming the effect.

## Choreography rules

### Scroll ranges

- Reserve approximately one viewport of scroll for each major pinned state as a starting point, then tune from the rendered result.
- Keep settling zones between dense transformations. A transition that never rests feels like a demo reel.
- Map state from normalized scene progress, not raw global scroll position.
- Clamp progress and define behavior for reverse scroll, fast scroll, reload mid-scene, resize, and content growth.

### Layer ownership

Use an explicit layer contract:

| Layer | Owns | Must not own |
| --- | --- | --- |
| Semantic DOM | Copy, links, controls, headings, reading order | Canvas-only essential text |
| Media DOM | Images, video, masks, crop, ordinary parallax | Route state or focus management |
| Canvas/WebGL | Pixel masks, large particle/object fields, shader transitions | Navigation or conversion content |
| Motion controller | Scene progress, timelines, teardown, breakpoints | Product data or business state |

Use canvas only when pixel-level masking, many independently moving elements, or shader processing materially improves the result. A large wordmark, image scale, crop reveal, and sticky sequence normally belong in DOM/CSS.

### Typography

- Keep an intact accessible string even when letters animate separately.
- Use mixed type roles intentionally: display serif or expressive face for emotion; neutral sans or mono for system labels and metadata.
- Animate a headline as lines or phrases before considering individual characters.
- Do not distort body copy, animate long paragraphs, or let moving type cross a primary control.

### Media

- Use `object-fit` and a deliberate focal point for every breakpoint.
- Give video a poster and stable aspect ratio.
- Pause offscreen video unless it must stay synchronized for an imminent scene.
- If audio exists, start muted and require a clear user action to enable it.
- Do not fake loading progress. A branded loader may visualize real progress or use an indeterminate state.

## Implementation selection

- Use CSS sticky positioning and scroll-driven animations for one-dimensional DOM transformations when target browsers and fallback requirements permit.
- Use GSAP ScrollTrigger for multi-beat pinning, labels, coordinated scrubbing, complex responsive timelines, or a project already using GSAP.
- Use the View Transition API for route or DOM-state continuity when progressive enhancement is acceptable; feature-detect it and preserve ordinary navigation.
- Use requestAnimationFrame plus a single normalized scroll source only for custom canvas work. Do not maintain a second unsynchronized scroll model.
- A smooth-scroll library is optional. If used, own one instance and synchronize every scroll-linked system with it.

## Motion starting points

These are tuning bands, not reproduction values:

| Transition | Starting behavior |
| --- | --- |
| Masked image expansion | 120–220vh scene; scale 0.55–0.75 to 1; clip inset toward 0 |
| Pinned process step | 70–110vh per state; 8–16vh blend or mask handoff |
| Editorial diptych | Left media sticky; right narrative remains normal flow |
| Media takeover | Oversized 1.4–1.9 scale to framed 0.55–0.8 scale; environment counter-scales |
| Gallery parallax | 3–10% travel relative to media height; vary direction sparingly |
| Object scatter | 4–8 hero objects; distinct lanes; rotation usually below 25 degrees |
| Route curtain | 450–800ms for marketing; content swap near maximum cover |

Avoid copying these bands blindly. Tune against viewport size, media composition, scroll input, and brand temperament.

## Reduced motion branches

Continuity branch:
- render the expanded or final media state immediately;
- replace scrubbed steps with stacked cards or short opacity changes;
- remove parallax while retaining the editorial composition.

Rupture branch:
- remove floating, rotation, glitch dispersion, and zoom travel;
- show the composed collage as a static poster;
- keep one short opacity transition if it does not create discomfort.

The reduced-motion version must preserve copy, controls, sequence, and conversion path.

## Mobile recomposition

- Replace long pinned chapters with discrete blocks when browser chrome, short viewports, or touch momentum makes pinning fragile.
- Reduce simultaneous moving layers before reducing image quality.
- Convert an asymmetric desktop diptych to a clear image-copy-image rhythm.
- Turn scattered objects into one composed poster or shallow layered cluster.
- Never crop the subject's face, product label, or interaction target merely to preserve desktop geometry.

## QA checkpoints

Capture the beginning, midpoint, and end of every transformation plus every discrete state. Test:
- slow, fast, and reverse scroll;
- reload at the middle of a pinned scene;
- scrollbar dragging and keyboard navigation;
- resize while pinned;
- route navigation during an active transition;
- touch momentum and orientation change;
- reduced motion and JavaScript failure;
- video failure, slow image decode, and late font load;
- focus order and pointer blocking while overlays exist.

Sources and verification:
- [Vero Studio](https://www.verostudio.com/)
- [Nothin'](https://www.noth.in/)
- [MDN — View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API)
- [MDN — CSS scroll-driven animations](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations)
- [MDN — `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- [GSAP — ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/)
