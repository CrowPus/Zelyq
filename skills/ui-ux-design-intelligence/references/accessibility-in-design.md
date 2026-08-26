# Accessibility in Design

## Target

For web, use WCAG 2.2 AA unless another requirement applies.

W3C recommends WCAG 2.2 as the new conformance target.

## Design-time requirements

### Focus
Focused components must remain visible and not be obscured by sticky headers/overlays under WCAG 2.2 AA requirements.

Design focus states intentionally.

### Target size
WCAG 2.2 AA introduces Target Size (Minimum): generally 24×24 CSS px or sufficient spacing/equivalent exceptions.

Platform guidance can be larger; Apple commonly recommends comfortable control sizes such as 44×44 pt on iOS/iPadOS.

### Dragging
Provide a non-drag single-pointer alternative unless dragging is essential.

### Authentication
Avoid cognitive tests/puzzles that prevent accessible authentication; support password managers and copy/paste as appropriate.

### Color
Meet applicable contrast and do not rely solely on color.

### Text
Support resizing/reflow. Avoid layouts that depend on one exact string length.

### Motion
Honor reduced-motion preferences and avoid intense unnecessary movement.

## Native before custom

WAI APG warns: "No ARIA is better than Bad ARIA."

ARIA roles are promises of behavior. A custom `role=button` does not gain keyboard behavior automatically.

At design time, prefer native/platform components where they meet the need.

## Keyboard model

For complex widgets, design the correct focus and keyboard model.

APG notes:
- Tab/Shift+Tab typically move between components;
- arrows often move inside composite widgets.

Do not make every item in a dense composite an independent Tab stop without reason.

## Screen reader structure

Design:
- landmarks;
- headings;
- labels;
- names/descriptions;
- status/error announcements.

## Review

- Can the task be completed without drag?
- Is focus visible everywhere?
- Does 200% zoom/large text preserve task completion?
- Are targets comfortably operable?
- Is important meaning perceivable without color?
- Do custom widgets have a real interaction/accessibility model?
