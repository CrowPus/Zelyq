# Motion QA matrix

Use this reference to verify implemented motion. Test the actual browser result; source inspection alone cannot prove motion quality.

## State and lifecycle

| Test | Pass condition |
| --- | --- |
| First entry | Correct initial state; no flash or hidden content after load |
| Exit | Final state is correct; stale layer does not intercept input |
| Rapid repeat | Repeated click/tap does not queue a long backlog |
| Reverse mid-flight | Motion continues from current visual state toward newest state |
| Route/unmount | Timelines, frames, observers, listeners, media, and GPU resources clean up |
| Background/foreground | Resume is stable; elapsed time does not produce a jump or runaway loop |
| Asset failure | Meaningful poster/static content remains |
| No enhancement support | Core content and interaction still work |

## Responsive and input

Test at narrow mobile, wide mobile, tablet, laptop, and large desktop; include at least one real touch device.

- Resize through breakpoints while a sequence is active.
- Test mouse, trackpad, touch, keyboard, and zoom.
- Confirm hover rules do not stick on touch.
- Confirm drag has click/tap discrimination and a keyboard alternative.
- Check portrait/landscape and dynamic mobile browser chrome.
- Verify sticky/pinned content does not obscure navigation or trap scroll.

## Accessibility

- Load with reduced motion already enabled.
- Toggle the site motion preference if one exists.
- Complete the workflow with keyboard only.
- Verify focus does not disappear or move unpredictably.
- Check meaningful state announcements with a screen reader.
- Confirm auto/ambient movement can be stopped.
- Inspect flash frequency and contrast.
- Zoom to 200%; confirm final layout and motion measurements survive reflow.

## Visual review

Capture start, one or more meaningful midpoints, and final state. For scroll stories capture each named beat in both directions.

Look for:

- competing focal points;
- inconsistent origins, directions, or easing;
- overshoot inappropriate to the brand;
- text or border distortion from scale;
- shadows lagging behind objects;
- masks clipping focus rings or content;
- motion that begins before the user sees its subject;
- excessive reveal repetition;
- unreadable text over moving visuals;
- CTA movement while a user tries to activate it.

## Performance evidence

Record the highest-risk sequence with performance tooling and note:

- device/viewport and refresh rate;
- CPU/network constraints;
- dropped or partially presented frames;
- main-thread layout/paint and long tasks;
- layer/GPU memory concerns;
- LCP, INP, and CLS impact where applicable;
- before/after measurements for a performance fix.

## Acceptance note template

```markdown
Motion: [name]
Purpose: [feedback / continuity / hierarchy / narrative / delight]
Full behavior: [trigger → beats → rest]
Reduced behavior: [replacement]
Fallback: [unsupported/failure state]
Input coverage: [keyboard/touch/pointer]
Lifecycle: [reverse/repeat/unmount]
Performance evidence: [device + recording summary]
Known tradeoff: [if any]
```
