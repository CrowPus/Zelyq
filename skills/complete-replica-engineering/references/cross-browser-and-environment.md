# Cross-Browser and Environment Fidelity

Pixel rendering can vary with:
- operating system;
- browser engine/version;
- fonts;
- device scale factor;
- hardware/rendering;
- headless mode;
- settings.

Playwright explicitly recommends generating and comparing visual baselines in the same environment.

## Certification language

Say:
- "exact under Chromium/Linux @ DPR 1 reference conditions"

rather than:
- "pixel-perfect everywhere"

unless additional environments were actually validated.

## Cross-browser mode

If project requires Chromium + Firefox + WebKit:
- create separate baselines per project/engine;
- inspect functional differences;
- accept platform-specific font rasterization only according to explicit thresholds.

Do not force CSS hacks solely to make different engines produce identical anti-aliasing if geometry and intended design are correct.

## Real Safari/Chrome caveat

Emulated/mobile browser profiles do not reproduce every engine/OS behavior. When exact target-browser parity matters, test the actual required engine/platform where possible.
