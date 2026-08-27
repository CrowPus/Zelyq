# Reference Capture

A reference screenshot is evidence only when its environment is known.

Record:
- URL/route;
- browser engine/version if important;
- viewport;
- device scale factor;
- screen/device emulation;
- theme;
- reduced motion;
- locale;
- timezone if visible;
- authenticated role;
- content/data state;
- scroll position;
- state/interaction.

## Wait for stable rendering

Before capture:
1. navigate;
2. wait for required app/content state;
3. await `document.fonts.ready`;
4. wait for intended image/lazy content;
5. settle or disable animations for static baselines;
6. hide caret/transient cursor artifacts;
7. capture.

Do not rely only on `networkidle` for applications with long-lived requests; define app-specific readiness where needed.

## Reference matrix

A useful matrix spans:
- important routes;
- key widths;
- themes;
- states;
- scroll checkpoints.

Capture only meaningful combinations, but enough to expose behavior.

## Authenticated/private references

Use authorized accounts and synthetic/non-sensitive content where possible.

Do not export cookies, tokens, or private data into shareable artifacts.
