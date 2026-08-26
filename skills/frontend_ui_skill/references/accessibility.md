# Accessibility — WCAG 2.2 + APG

## Target

For ordinary production interfaces, target WCAG 2.2 AA unless the project has a different contractual/legal target.

W3C recommends WCAG 2.2 for new accessibility work. It includes newer criteria for focus not obscured, dragging alternatives, target size, redundant entry, and accessible authentication.

Source: https://www.w3.org/TR/WCAG22/

## Native first

Use native semantics before ARIA.

Examples:
- button → `<button>`;
- navigation → `<a href>`;
- checkbox → `<input type="checkbox">`;
- static tabular data → `<table>`.

WAI-ARIA APG explicitly encourages native HTML equivalents where available.

## Keyboard

Every interactive function must be operable from keyboard when appropriate.

Test manually with:
- Tab;
- Shift+Tab;
- Enter/Space;
- Escape;
- arrow keys where the APG pattern requires them.

Do not create keyboard behavior from intuition for complex widgets. Follow the APG pattern.

## Dialog

For modal dialogs, APG expects:
- focus moves inside on open;
- Tab/Shift+Tab stay within the modal;
- Escape closes;
- a clear accessible name;
- focus restoration/placement after close appropriate to workflow.

Source: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/

## Focus

Never remove focus indication without an equally visible replacement.

Check sticky headers, cookie banners, bottom bars, and dialogs do not obscure focused elements. WCAG 2.2 includes Focus Not Obscured at AA.

## Names, roles, values

Icon-only buttons need an accessible name. Visible text should normally be part of the accessible name rather than replaced by a conflicting label.

## Forms

Associate:
- label;
- instructions;
- description;
- errors;
- required state.

Use correct `autocomplete` tokens for personal data. MDN notes this reduces cognitive/motor burden and supports WCAG input-purpose requirements.

## Status messages

Loading, success, validation, and background updates may need programmatic announcement. Do not add `aria-live` to everything; use it for meaningful status changes.

## Color and contrast

Do not rely on color alone. Check text contrast and non-text control/focus contrast against WCAG requirements.

## Motion

Respect `prefers-reduced-motion` for non-essential motion. Do not disable transitions blindly; design a lower-motion equivalent.

## Automated testing is partial

Playwright's official accessibility guide recommends combining automated axe testing with manual assessment because automated tools can only identify some classes of accessibility problems.

Source: https://playwright.dev/docs/accessibility-testing

## Screen reader smoke test

For important flows, verify at least:
- landmarks/headings make sense;
- control names are understandable;
- errors/status are discoverable;
- modal/menu/tab widgets announce state correctly.
