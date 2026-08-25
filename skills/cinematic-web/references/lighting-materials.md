# Lighting and Materials

## Goal

Create readable, controlled product imagery before adding post-processing.

## Reveal form

Ask:
- Where is the important edge?
- Which surface should catch the eye?
- Which silhouette must stay readable?
- Which material property communicates the product?

Lighting exists to reveal form.

## Product baseline

For many physically based product scenes, begin with:
- environment lighting for broad reflections;
- one directional/key source for shape;
- optional rim/fill for separation;
- restrained background.

Do not add many lights simply to make the scene brighter.

## Materials

Use physically based materials when realistic light response matters.

`MeshPhysicalMaterial` adds advanced physical effects beyond basic PBR and can be more expensive. Enable transmission, clearcoat, iridescence, sheen, etc. only when the intended material calls for them.

## Color management

Three.js performs lighting in a linear working color space and output conversion/tone mapping can alter displayed colors.

When exact DOM/WebGL color matching matters:
- use correct texture color-space annotations;
- understand renderer tone mapping;
- do not compensate by randomly changing hex values.

For editorial/unlit planes where exact display color matters, an unlit/basic material or disabled tone mapping may be appropriate.

## Shadows

Shadows are often optional for floating product shots.

If used:
- minimize shadow-casting lights;
- tighten shadow camera bounds;
- use adequate but not excessive map resolution;
- consider simpler contact/blob grounding.

## Post-processing

Add after composition, camera, lighting, material, and background already work.

### Bloom
Use for truly emissive/high-energy elements. Excessive bloom destroys material readability.

### Depth of field
Use when focus direction is intentional. It can be expensive and distracting during large scroll-linked camera moves.

### Grain/vignette
Use subtly; never reduce text clarity.

## Mobile

Prefer:
- fewer dynamic lights;
- lower/no shadows;
- fewer post-processing passes;
- simpler material features;
- lower DPR.

## Sources

- https://threejs.org/docs/
- https://threejs.org/manual/en/color-management.html
