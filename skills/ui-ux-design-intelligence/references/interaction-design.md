# Interaction Design

## Goal

Make actions discoverable, predictable, reversible where possible, and efficient for both novice and experienced users.

## Interaction contract

For each action define:
- affordance;
- trigger;
- immediate feedback;
- pending state;
- completion;
- failure;
- recovery;
- cancellation;
- undo where meaningful.

## Familiarity

Platform conventions reduce learning cost.

Custom interaction is justified only when:
- native/familiar patterns cannot support the task well;
- benefit exceeds learning/accessibility cost;
- behavior is teachable and consistent.

## Feedback

No consequential action should feel ambiguous.

Examples:
- button pressed state;
- save progress;
- upload progress;
- explicit success;
- error linked to recovery;
- selection state distinct from focus.

## Agency

Users should understand:
- what will happen;
- whether it can be undone;
- how to leave;
- whether work is saved.

Do not trap people in guided experiences.

## Error prevention

Prefer preventing mistakes over writing better error messages:
- sensible defaults;
- constraints;
- previews;
- disabling impossible options with explanation;
- confirmation only for meaningful irreversible/high-cost actions.

## Undo vs confirmation

For low-risk reversible actions, undo can be less disruptive than confirmation.

For high-impact irreversible actions, use stronger confirmation and communicate consequences clearly.

## Expert efficiency

For frequent/complex applications consider:
- keyboard shortcuts;
- bulk actions;
- command/search interfaces;
- persistent filters;
- repeat-last action;
- saved views.

Do not expose complexity to novices merely because experts need speed.

## Direct manipulation

Dragging can be useful for spatial tasks, but WCAG 2.2 requires a non-drag single-pointer alternative unless dragging is essential.

## State continuity

Preserve context across:
- navigation;
- modal close;
- failed submission;
- back/forward;
- refresh where product semantics support it.

## Review

- Is every action discoverable?
- Is the result obvious?
- Can users recover?
- Are dangerous actions differentiated?
- Are expert shortcuts optional rather than mandatory?
