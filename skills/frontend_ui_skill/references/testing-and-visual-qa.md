# Testing and Visual QA

## Test behavior at the lowest useful layer

### Unit
Pure formatting, reducers, validation logic, utility calculations.

### Component/render
Important visual/data states and component contracts.

### Interaction
Keyboard/click/type/submit behavior and state transitions.

### End-to-end
Critical multi-page/server-integrated user journeys.

Do not duplicate the same assertion at every layer without a reason.

## Query like a user

Testing Library/Storybook guidance prefers role, label, and accessible text queries before test IDs.

Storybook interaction tests explicitly recommend user-facing queries such as `findByRole` and `findByLabelText`.

Source: https://storybook.js.org/docs/writing-tests/interaction-testing

## Accessibility automation

Use axe/Playwright or Storybook a11y to catch machine-detectable problems. Do not claim accessibility conformance from automation alone.

Source: https://playwright.dev/docs/accessibility-testing

## Visual regression

Visual diffs are valuable for:
- component states;
- layout shifts;
- responsive regressions;
- theme changes;
- accidental spacing/type changes.

Playwright supports `toHaveScreenshot()` comparisons; keep screenshot environment stable because OS/browser/rendering differences affect pixels.

Source: https://playwright.dev/docs/test-snapshots

## Browser QA matrix

Inspect applicable states at:
- narrow mobile;
- desktop;
- dark/high contrast if supported;
- keyboard navigation;
- reduced motion if motion exists;
- loading/error/empty;
- long content.

## Console

Browser console errors/warnings are signals. Do not ignore hydration errors, failed resource loads, React key warnings, or accessibility/library warnings just because the page looks okay.

## Visual review questions

- Is hierarchy obvious in 3 seconds?
- Are alignments and spacing coherent?
- Are focus/error/loading states visually integrated?
- Does real content wrap cleanly?
- Does mobile feel designed, not collapsed?
- Are hit targets comfortable?
- Is any UI clipped or hidden behind fixed chrome?
