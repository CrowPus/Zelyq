# Design System Strategy

## Purpose

A design system is a shared language for product decisions, not merely a component inventory.

It should encode:
- brand;
- accessibility;
- hierarchy;
- interaction;
- density;
- responsive behavior;
- platform expectations.

## Layers

### Foundations
Color, type, spacing, shape, motion, iconography.

### Semantic roles
`text-primary`, `surface-raised`, `action-primary`, `status-danger`, etc.

### Components
Buttons, inputs, navigation, dialogs, tables.

### Patterns
Search, checkout, onboarding, filtering, empty states.

### Product rules
When/why each pattern is used.

## Existing systems

Before creating anything:
- search for equivalent token/component;
- inspect variants;
- understand naming;
- understand deprecation/migration.

Do not create `Button2` because an existing button seems inconvenient.

## Variants

A component variant is justified by a meaningful semantic/behavioral difference.

Avoid combinatorial APIs like:
- 9 colors;
- 6 radii;
- 5 shadow levels;
- 7 visual variants

without system rationale.

## Component anatomy

Document:
- slots;
- states;
- content constraints;
- interaction;
- accessibility;
- responsive behavior;
- when to use/not use.

## Governance

A mature design system needs:
- ownership;
- contribution criteria;
- versioning;
- deprecation;
- migration;
- visual regression/testing;
- documentation.

## Page overrides

A global system may allow page/context overrides when the task truly differs.

Overrides should describe **deviations**, not duplicate the entire system.

## Review

- Does the system reduce arbitrary decisions?
- Do semantic names survive theme changes?
- Are components composable enough for real product needs?
- Are exceptions explicit rather than random?
