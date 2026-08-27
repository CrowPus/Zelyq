# Typography Fidelity

Typography determines geometry.

A small mismatch in font metrics can cause:
- different line breaks;
- different card heights;
- button width drift;
- changed page length;
- misaligned grids.

## Fingerprint

For each role record:
- family;
- actual loaded font face;
- weight/style;
- font-size;
- line-height;
- letter-spacing;
- transform;
- numeric variant;
- text rendering/features where material.

## Wait for fonts

Capture only after `document.fonts.ready` for used fonts.

## Font fallback

If exact font is unavailable:
- do not silently claim exact typography;
- choose closest authorized/system fallback;
- compare wrap/measure;
- document constraint.

## Line wrapping

Line breaks are evidence.

Do not insert arbitrary `<br>` tags to imitate one screenshot if the reference wraps naturally across widths.

Use explicit breaks only when the reference clearly authored them.

## Variable fonts

Match actual axis values/weight behavior where visible.

A numeric `font-weight:600` may render differently if the intended face is missing.
