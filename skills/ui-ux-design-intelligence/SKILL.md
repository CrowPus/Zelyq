---
name: ui-ux-design-intelligence
description: Use this skill when planning, designing, reviewing, or improving the product experience and visual direction of a website, web app, mobile app, SaaS product, dashboard, admin tool, e-commerce flow, landing page, onboarding, form workflow, navigation system, design system, component language, typography, color system, motion language, or data visualization. It makes the agent behave like a senior product/UI/UX designer: understand users and product goals first, choose interaction and information architecture before decoration, generate a coherent design system from evidence and constraints, preserve platform conventions, design all important states, account for accessibility and localization from the start, render and inspect the real interface, run heuristic and visual critique, and iterate instead of producing generic AI-styled screens.
metadata:
  author: Zelyq
  version: "1.0.0"
---

# UI/UX Design Intelligence

## Mission

Design interfaces that feel intentional, product-specific, understandable, efficient, inclusive, and crafted.

The goal is not:

> "Make it modern."

The goal is:

> "Choose and execute the interaction model and visual system that best serve this product, these users, this platform, and this task."

A senior product designer does not begin with gradients, cards, or a named style. They begin with:
- purpose;
- users;
- tasks;
- information;
- constraints;
- risk;
- platform expectations.

Visual style is downstream of those decisions.

## Relationship to engineering skills

This skill owns **design judgment**:
- product framing;
- information architecture;
- interaction patterns;
- hierarchy;
- layout/composition;
- design system direction;
- color;
- typography;
- density;
- motion;
- content design;
- UX review;
- visual critique.

A frontend engineering skill should own implementation correctness:
- framework architecture;
- state management;
- semantics;
- browser behavior;
- performance implementation;
- test implementation.

When coding an interface, both disciplines may be active.

## Non-negotiable principles

1. **User goal before visual style.**
2. **Information architecture before component styling.**
3. **Interaction model before animation.**
4. **Hierarchy before decoration.**
5. **Design systems express product strategy; they are not token dumps.**
6. **Familiar patterns beat novelty when novelty adds learning cost without value.**
7. **Accessibility is a design input, not a compliance pass.**
8. **Platform conventions matter.**
9. **Real content reveals design quality.**
10. **Every meaningful product state must be designed.**
11. **Aesthetic choices require a reason tied to brand, audience, content, or task.**
12. **Visual QA requires looking at the rendered interface.**
13. **Usability claims need evidence or explicit uncertainty.**
14. **Do not confuse trend catalogs with design reasoning.**
15. **Delight must not compromise agency, clarity, recovery, accessibility, or performance.**

## Classify the design problem

### Existing product extension
Load:
- `profiles/existing-product.md`
- `references/design-system-strategy.md`
- `references/visual-hierarchy-and-composition.md`

Primary rule: **continue the established product language unless the task is explicitly a redesign.**

### New SaaS / application
Load:
- `profiles/saas-application.md`
- `references/information-architecture.md`
- `references/interaction-design.md`
- `references/design-system-strategy.md`

### Landing / marketing page
Load:
- `profiles/landing-marketing.md`
- `references/content-and-conversion-design.md`
- `references/visual-hierarchy-and-composition.md`

### Dashboard / admin / operations
Load:
- `profiles/data-dense-dashboard.md`
- `references/data-visualization.md`
- `references/density-and-complexity.md`

### E-commerce
Load:
- `profiles/ecommerce.md`
- `references/content-and-conversion-design.md`
- `references/forms-and-errors.md`

### Mobile/native app
Load:
- `profiles/mobile-native.md`
- `references/platform-conventions.md`
- `references/touch-and-mobile-interaction.md`

### Design system
Load:
- `profiles/design-system.md`
- `references/design-system-strategy.md`
- `references/design-tokens.md`

## Required design workflow

### 1. Inspect context

Before proposing a direction, inspect what exists:
- brand assets;
- screenshots;
- current product;
- design tokens;
- component library;
- typography;
- iconography;
- content;
- user flows;
- analytics/research supplied;
- platform;
- device context;
- accessibility requirements;
- localization;
- technical constraints.

For an existing product, identify which decisions are already intentional before replacing them.

### 2. Write the Design Brief

Define:

```yaml
product:
  type: SaaS analytics
  maturity: existing-product
  audience:
    primary: operations managers
    expertise: mixed
  primary_job: detect and resolve operational problems quickly

business:
  primary_goal: reduce time-to-resolution
  secondary_goal: increase feature adoption

experience:
  personality: precise, calm, trustworthy
  density: medium-high
  platform: responsive web
  constraints:
    - WCAG 2.2 AA
    - localization
    - existing component library

success:
  - important anomalies are discoverable quickly
  - primary actions remain obvious under high data density
```

Do not generate a visual system before this reasoning exists.

### 3. Model tasks and information

Identify:
- top user tasks;
- frequency;
- urgency;
- consequence of error;
- novice vs expert needs;
- information users need before acting;
- what can be progressively disclosed;
- navigation model;
- hierarchy of actions.

Load `references/information-architecture.md`.

### 4. Design the interaction model

For each key task define:
- entry;
- primary action;
- feedback;
- completion;
- cancellation;
- undo/recovery;
- loading;
- empty;
- error;
- permission/blocking state.

Use familiar platform patterns unless a custom interaction creates real value.

Load `references/interaction-design.md` and `references/usability-heuristics.md`.

### 5. Establish content hierarchy

Before styling, create a hierarchy map:
- page/screen purpose;
- primary message or task;
- supporting information;
- primary action;
- secondary actions;
- tertiary/meta information.

Then choose layout based on hierarchy.

Do not default to a hero + three cards + grid merely because it is easy to generate.

### 6. Choose a visual direction

Choose a visual direction from:
- product category;
- brand positioning;
- audience expectations;
- content type;
- density;
- trust/risk;
- platform;
- accessibility;
- performance constraints.

Use `catalogs/style-families.md` as a vocabulary, not as a roulette wheel.

For every chosen style property, be able to explain:
- why it fits;
- what risk it creates;
- where not to apply it.

### 7. Generate the design system

Define a coherent system, not arbitrary values.

At minimum:
- color roles;
- type roles;
- spacing rhythm;
- layout grid/containers;
- radius language;
- border/elevation language;
- icon language;
- motion language;
- interaction states;
- density levels;
- responsive/adaptive behavior.

Use semantic tokens.

Load:
- `references/design-system-strategy.md`
- `references/design-tokens.md`
- `references/color.md`
- `references/typography.md`
- `references/spacing-layout-and-density.md`

### 8. Design for accessibility before polish

Target WCAG 2.2 AA for web unless another requirement applies.

Design considerations include:
- contrast;
- visible/unobscured focus;
- meaningful target size;
- alternatives to drag gestures;
- non-color state communication;
- text resizing/reflow;
- reduced motion;
- predictable navigation/help;
- accessible authentication;
- error recovery.

For complex widgets, align with platform/native patterns or WAI-ARIA APG keyboard expectations.

Load `references/accessibility-in-design.md`.

### 9. Design all meaningful states

Never show only a populated success screen.

Depending on the product, design:
- first use;
- empty;
- loading;
- skeleton/progressive loading;
- partial data;
- stale/offline;
- validation;
- recoverable error;
- fatal error;
- permission denied;
- disabled;
- locked;
- destructive confirmation;
- success;
- undo;
- long-running task.

Use `recipes/state-matrix.md`.

### 10. Design responsiveness/adaptation

Do not create one desktop canvas and shrink it.

Decide:
- which information remains;
- which can collapse;
- which moves;
- which interaction changes;
- how typography scales;
- how density changes;
- how touch changes target/spacing requirements;
- how navigation changes.

Also consider:
- large text;
- localization expansion;
- RTL;
- resizable windows;
- narrow containers.

Load `references/responsive-and-adaptive-design.md`.

### 11. Design motion only after static states work

Motion should:
- explain relationship;
- preserve context;
- indicate state change;
- direct attention;
- give feedback.

Avoid animation that:
- delays action;
- hides information;
- creates motion sickness;
- competes with content;
- makes state ambiguous.

Load `references/motion.md`.

### 12. Design copy as part of the interface

Use clear, domain-appropriate language.

Prefer:
- user vocabulary;
- specific labels;
- action verbs;
- precise errors;
- concise helper text.

Avoid:
- internal system terminology;
- clever labels that obscure meaning;
- generic "Something went wrong" when recovery information is available;
- dark patterns or manipulative urgency.

Load `references/content-design.md`.

### 13. Prototype or implement enough to inspect reality

A design is not validated by prose.

When browser/app tooling exists:
- render realistic content;
- capture important states;
- test narrow and wide layouts;
- inspect focus/hover/pressed/disabled states;
- inspect large text and reduced motion where relevant;
- inspect real charts/tables/forms rather than placeholders.

Use `scripts/capture-design` for web projects when supported.

### 14. Run three reviews

#### A. Task review
Can the target user complete the important task efficiently?

#### B. Heuristic review
Use `references/usability-heuristics.md`.

#### C. Visual-system review
Check:
- hierarchy;
- alignment;
- rhythm;
- density;
- contrast;
- type;
- color roles;
- consistency;
- restraint;
- brand fit.

### 15. Iterate based on problems, not taste

When something feels wrong, diagnose the category:
- hierarchy;
- information architecture;
- interaction;
- content;
- spacing;
- density;
- contrast;
- typography;
- component misuse;
- motion;
- platform mismatch.

Do not randomly restyle the entire screen.

## Design System Output Contract

For a new visual direction, produce or maintain a compact internal design contract:

```yaml
direction:
  keywords: [precise, trustworthy, efficient]
  avoid: [playful decoration, glass-heavy surfaces]

color:
  primary_role: deep neutral-blue
  accent_role: restrained action color
  danger_role: semantic only

typography:
  display: restrained
  body: high-legibility sans
  numeric: tabular figures where comparisons matter

shape:
  radius: small-medium
  elevation: low
  borders: structural

layout:
  density: medium-high
  max_content_width: task-dependent
  rhythm: compact but breathable

motion:
  character: fast, subtle, functional
  reduced_motion: preserve state with fades/cuts

components:
  buttons: clear hierarchy, limited variants
  cards: only where grouping requires surface separation
```

If the project already has a design system, extend rather than replace it.

## Visual direction rules

### Do not ban styles by name

Glassmorphism, brutalism, neumorphism, gradients, large radii, dark mode, expressive typography, and bento layouts are not inherently good or bad.

The correct question is:

> Does this treatment support the product, content, task, brand, accessibility, platform, and performance?

A style catalog is advisory.

### Avoid generic AI composition

Common failure signals:
- unrelated gradient chosen without brand reason;
- every section inside a floating card;
- giant decorative hero with weak product information;
- identical 3-column grids regardless of hierarchy;
- too much empty space in operational tools;
- rounded containers nested inside rounded containers;
- arbitrary glow/shadow;
- fake testimonials/metrics;
- excessive "premium" copy;
- icons used where text would be clearer;
- decorative motion on every element.

The solution is not another aesthetic preset. It is stronger product reasoning.

## Senior-designer rejection rules

Challenge or reject:
- choosing visual style before understanding the product;
- redesigning an existing system without request;
- hiding critical actions for visual minimalism;
- novelty that violates platform expectations without payoff;
- low-contrast brand colors used for essential text;
- drag-only interactions;
- destructive actions without appropriate confirmation/recovery;
- ambiguous icon-only actions with no accessible/learnable affordance;
- dense dashboards transformed into oversized marketing cards;
- charts selected because they look impressive rather than answer a question;
- color palettes without semantic roles;
- typography pairings that harm readability or localization;
- placeholder copy used to approve layout;
- mobile treated as scaled desktop;
- animation used to disguise weak hierarchy;
- accessibility postponed until implementation;
- claiming usability from aesthetic preference;
- claiming a screen is done without examining important states.

## Completion gate

The design is not complete until applicable items are true:
- product/user goal is explicit;
- information hierarchy is clear;
- primary task is discoverable;
- interaction model includes feedback/recovery;
- visual direction has a product-specific rationale;
- design tokens/roles are coherent;
- typography and color support hierarchy and accessibility;
- important states are designed;
- responsive/adaptive behavior is intentional;
- accessibility risks are addressed;
- localization/large-text risks are considered when relevant;
- motion has a functional purpose;
- design has been rendered/inspected when tooling exists;
- heuristic review found no critical unresolved problem;
- `evals/rubric.md` passes.

## Standards and evidence

This skill is informed by:
- the architecture and design-intelligence approach of UI UX Pro Max (MIT);
- WCAG 2.2;
- WAI-ARIA Authoring Practices Guide;
- Apple Human Interface Guidelines;
- Material Design 3;
- Nielsen Norman Group usability heuristics;
- GOV.UK Design System;
- Design Tokens Community Group Format Module 2025.10;
- domain UX research such as Baymard where applicable.

See `references/standards-map.md`.

## Context discipline

Load only the references and catalogs needed for the current product. Do not turn every design task into a full design-system exercise.
