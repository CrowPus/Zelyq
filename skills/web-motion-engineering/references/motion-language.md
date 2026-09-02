# Motion language and direction

Use this reference when planning a new motion system, defining a brand motion language, or correcting an experience that feels generic.

## The motion brief

For every major sequence, write one row before implementation:

| Field | Question |
| --- | --- |
| Purpose | What becomes easier to understand, feel, or accomplish? |
| Trigger | Direct input, state change, viewport entry, route change, time, or scroll progress? |
| Subject | Which object owns the movement? |
| Continuity | What should appear to persist between states? |
| Origin/destination | Where does it physically or conceptually come from and go? |
| Priority | Primary focal motion, supporting motion, or ambient texture? |
| Timing | Token, stagger relationship, and total perceived wait? |
| Interruption | What happens on reverse, repeat, navigation, resize, or unmount? |
| Reduced branch | Remove, shorten, replace with fade/color, or provide manual playback? |
| Fallback | What is shown without the engine, asset, API, or WebGL? |
| Evidence | How will browser behavior and performance be verified? |

If purpose, resting state, or reduced branch is unclear, the motion is not ready to build.

## Productive versus expressive

Professional products need contrast:

- **Productive motion** is efficient, subtle, and frequent. It confirms input, explains spatial relationships, maintains object identity, or softens a state change. Users should remain focused on their task.
- **Expressive motion** is noticeable and rare. It earns attention at a brand reveal, first-run moment, major completion, or narrative transition.

IBM Carbon explicitly separates productive and expressive motion and recommends reserving expression for important moments. Microsoft Fluent similarly describes good motion as functional, natural, consistent, and appealing. Use these as decision models, not as visual styles to copy.

## Brand motion attributes

Choose three attributes and translate each into behavior. Example for a serious AI developer tool:

| Attribute | Motion implication |
| --- | --- |
| Precise | Clean alignment, controlled curves, no noisy overshoot |
| Intelligent | Related objects anticipate and respond; transitions preserve context |
| Fast | Immediate acknowledgement; short product durations |
| Calm | Limited concurrent movement; no perpetual attention-seeking |
| Powerful | Decisive direction and scale used only at major moments |

Avoid vague traits such as “modern” unless they produce observable rules.

## Build a recognizable grammar

Define:

- **Primary direction:** for example, deeper detail moves forward/up while returning moves back/down.
- **Signature transformation:** one repeatable brand action, such as a line resolving into a complete structure, a focused beam revealing capability, or connected nodes organizing into a system.
- **Depth rule:** how elevation, blur, scale, and shadow change together.
- **Reveal rule:** masks, opacity, clipping, or movement—and where each is allowed.
- **Choreography rule:** which element leads, which follows, and the maximum stagger span.
- **Ambient rule:** whether background motion exists, how subtle it is, and when it stops.

Do not use the signature transformation on every component. Recognition comes from consistency and scarcity.

## Hierarchy

At any moment, one object leads. Supporting motion should reinforce the same event rather than compete for attention.

- One dominant movement cluster per viewport.
- Group elements that share a cause.
- Stagger only related items and cap the overall sequence so the last item does not feel late.
- Avoid animating every section on scroll. Static sections create contrast and let the signature moments breathe.
- Repeat visitors and high-frequency workflows get less ceremony than first-run or marketing moments.

## Story beats for narrative pages

Translate marketing structure into visible change:

1. **Promise:** establish atmosphere and one clear subject.
2. **Tension:** show the fragmented, slow, or confusing current state.
3. **Transformation:** the product organizes, connects, accelerates, or reveals.
4. **Proof:** motion steps back while real UI, numbers, or outcomes become readable.
5. **Action:** the interface settles; the call to action is stable and obvious.

Motion cannot replace positioning or proof. If the story does not persuade as a static storyboard, animation will not rescue it.
