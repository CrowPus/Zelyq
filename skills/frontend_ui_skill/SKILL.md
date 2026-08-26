---
name: frontend-ui-engineering
description: Use this skill for building, modifying, reviewing, or debugging user-facing web interfaces that must be production-quality. It covers semantic HTML, design-system adherence, component architecture, state/data flow, forms, responsive and container-aware layout, WCAG 2.2 accessibility, keyboard/focus behavior, async/loading/error/empty states, frontend security, performance/Core Web Vitals, SEO for public/indexable pages, internationalization, browser compatibility, interaction design, and visual/browser QA. The goal is not generic polish; it is frontend work that behaves like a strong design-aware senior frontend engineer built and verified it.
metadata:
  author: Zelyq
  version: "1.0.0"
---

# Frontend UI Engineering

## Mission

Build interfaces that are correct, usable, accessible, responsive, performant, secure, visually intentional, and maintainable.

The standard is not:

> "The page renders and looks modern."

The standard is:

> "The interface communicates the product clearly, behaves correctly in every important state, follows the project's visual language, works with real input methods and assistive technology, survives realistic content and viewport variation, and has been inspected in a browser."

Do not manufacture a generic "AI look." Do not impose a personal aesthetic on an existing product. Infer and extend the product's actual visual system.

## Core principles

1. **Understand the product before styling it.**
2. **Use native web semantics before ARIA recreation.**
3. **Use the project's design system before inventing new tokens.**
4. **Model all meaningful UI states, not only the success screenshot.**
5. **Keep state minimal and give each piece a clear owner.**
6. **Design components for their container, content, and interaction—not only fixed viewport breakpoints.**
7. **Accessibility is behavior, not an attribute pass.**
8. **Performance includes interaction responsiveness, not only initial load.**
9. **Public/indexable pages require semantic and search-aware engineering.**
10. **Inspect the rendered UI. Source code is insufficient evidence of visual quality.**

## Start by classifying the interface

Do not apply every concern blindly.

### Existing product UI
Preserve the established tokens, component primitives, spacing rhythm, typography, interaction conventions, iconography, density, and information architecture. Do not redesign a product when asked to implement a feature.

### New application UI
Load:
- `profiles/application-ui.md`
- `references/design-system-and-visual-language.md`
- `references/component-architecture.md`
- `references/state-and-data-flow.md`

### Public / marketing / content page
Load:
- `profiles/public-site.md`
- `references/seo-and-document-semantics.md`
- `references/performance.md`
- `references/accessibility.md`

### Data-dense dashboard/admin
Load:
- `profiles/data-dense-ui.md`
- `recipes/data-table.md`
- `references/performance.md`

### Form-heavy workflow
Load:
- `profiles/forms-workflow.md`
- `references/forms-and-validation.md`
- `references/accessibility.md`

### E-commerce / conversion flow
Load:
- `profiles/ecommerce.md`
- `references/forms-and-validation.md`
- `references/performance.md`

### International / localized UI
Load `references/internationalization.md`.

## Required workflow

### 1. Inspect before coding

Inspect the existing project for:
- framework/runtime versions;
- routing/rendering strategy;
- CSS methodology;
- design tokens/themes;
- existing primitives;
- icon and typography systems;
- data-fetching/cache strategy;
- form libraries;
- localization;
- tests and Storybook;
- accessibility conventions;
- browser support/Baseline policy;
- analytics/SEO conventions;
- loading/error patterns.

Search for an existing component before creating a near-duplicate.

### 2. Understand the user task

Identify:
- primary user goal;
- critical information;
- primary and secondary actions;
- destructive actions;
- empty state;
- loading state;
- partial state;
- error state;
- permission state;
- disabled/unavailable state;
- offline/stale state when relevant;
- mobile constraints;
- keyboard/focus flow.

A UI is a state machine, not a screenshot.

### 3. Establish information hierarchy

Before decoration:
- determine page title and section hierarchy;
- establish visual priority;
- identify what users scan versus read;
- group related controls and content;
- remove unnecessary surfaces/containers;
- reserve visual emphasis for meaningful decisions.

Do not begin by creating cards everywhere.

### 4. Use semantic HTML first

Prefer native elements:
- `<button>` for actions;
- `<a>` for navigation;
- `<input>`, `<select>`, `<textarea>` for forms;
- `<dialog>` or a proven accessible primitive for dialogs;
- `<table>` for static tabular data;
- landmarks and correct headings for document structure.

ARIA supplements semantics; it does not replace semantic HTML.

For complex widgets, follow the relevant WAI-ARIA Authoring Practices pattern and keyboard model. Load `references/accessibility.md`.

### 5. Define component boundaries

Create components around reusable visual/behavioral concepts, independent responsibilities, meaningful state ownership, and independently testable behavior.

Do not split by arbitrary line count.

Prefer composition when consumers need structural flexibility. Prefer explicit configuration when the component is a constrained design-system primitive.

Load `references/component-architecture.md`.

### 6. Model state deliberately

For React-style systems:
- keep each unique piece of state at one clear owner;
- avoid redundant and duplicated state;
- derive values during render when possible;
- avoid contradictory booleans when a finite status is clearer;
- keep server state in the server-state/cache layer;
- use URL state for shareable/navigable filters and pagination where appropriate;
- use effects for synchronization with external systems, not derived state or event logic.

Do not introduce a global store merely to avoid passing props.

Load `references/state-and-data-flow.md`.

### 7. Design with real content

Use realistic names, labels, dates, currency, long titles, empty strings, long values, localized text expansion, image aspect ratios, and error messages. Test wrapping, truncation, overflow, and density.

Placeholder content can hide real layout failures.

### 8. Build responsive behavior from constraints

Use intrinsic layout, flex/grid, min/max/clamp where appropriate, media queries for viewport-level adaptation, and container queries for reusable components that must adapt to available space.

Do not equate responsive design with exactly four device widths.

Always test narrow mobile, wide mobile/small tablet, medium, desktop, constrained component containers, and zoom/reflow when relevant.

Load `references/responsive-layout.md` and `references/browser-platform-and-interaction.md`.

### 9. Use a coherent visual system

Before adding new values, inspect existing tokens.

Maintain deliberate hierarchy across type scale, spacing scale, radius, borders, elevation, surfaces, semantic colors, motion, and icon sizing.

Avoid "AI aesthetic" by avoiding **ungrounded defaults**, not by banning specific colors. A purple gradient may be correct if the product uses it; it is wrong when chosen because no product language was understood.

Load `references/design-system-and-visual-language.md`.

### 10. Implement accessibility behavior

Target WCAG 2.2 AA for normal production work unless the project requires another target.

Verify:
- keyboard access;
- visible and unobscured focus;
- logical focus order;
- correct accessible names;
- label/instruction/error association;
- status announcements;
- sufficient contrast;
- target sizes;
- zoom/reflow;
- reduced motion;
- drag alternatives;
- semantic headings/landmarks;
- accessible authentication/form flows where relevant.

Automated scans are useful but insufficient. Manual keyboard and behavior testing remain required.

### 11. Handle async UI as a product state

For remote data/actions decide:
- initial loading;
- refresh/revalidation;
- stale data;
- empty result;
- partial result;
- recoverable error;
- retry;
- mutation pending;
- optimistic state;
- rollback;
- duplicate submission prevention;
- cancellation/race behavior.

Use skeletons only when they preserve spatial expectation. A spinner is appropriate for small indeterminate actions; it is not universally wrong.

Load `references/async-states-and-feedback.md`.

### 12. Build forms as workflows

For forms:
- use correct input types;
- use visible labels;
- use useful `autocomplete` tokens;
- keep server validation authoritative;
- validate at useful times without punishing typing;
- preserve input on recoverable failure;
- move/announce focus appropriately after submission;
- make errors specific and actionable;
- prevent accidental duplicate submission;
- support password managers and accessible authentication.

Load `references/forms-and-validation.md`.

### 13. Protect the browser boundary

Do not treat frontend code as trusted authorization.

Avoid unsafe DOM sinks for untrusted content. Prefer framework escaping and text APIs; sanitize truly required HTML. Treat CSP and Trusted Types as defense in depth when the application architecture supports them.

Never expose secrets, privileged tokens, internal credentials, or authorization assumptions in client code.

Load `references/frontend-security.md`.

### 14. Protect performance

For applicable interfaces:
- keep JavaScript and hydration cost proportionate;
- avoid unnecessary client rendering;
- reserve dimensions for media/async content;
- optimize LCP resources;
- keep interaction handlers short;
- avoid layout thrashing;
- virtualize only when data size justifies it;
- lazy-load non-critical code/media;
- use responsive images;
- avoid expensive rerender chains;
- test a production build on constrained hardware.

Current common "good" Core Web Vitals targets are LCP ≤ 2.5 s, INP ≤ 200 ms, and CLS ≤ 0.1 at the 75th percentile.

Load `references/performance.md`.

### 15. Handle SEO only where it applies

For public/indexable pages:
- meaningful `<title>`;
- descriptive headings;
- useful metadata;
- crawlable links;
- canonical/robots handling when applicable;
- meaningful image alt text;
- structured data only when it accurately represents visible content and follows the relevant search feature rules;
- meaningful crawlable primary content appropriate to the chosen rendering stack.

Do not add SEO ceremony to authenticated application screens that should not be indexed.

Load `references/seo-and-document-semantics.md`.

### 16. Respect language and locale

When relevant:
- declare document/part language;
- format dates/numbers/currency with locale-aware APIs;
- avoid string concatenation that breaks translation grammar;
- allow text expansion;
- support RTL logically rather than mirroring random icons;
- avoid embedding locale assumptions in business logic.

Load `references/internationalization.md`.

### 17. Test at the right layers

Use the smallest layer that proves the behavior:
- unit tests for pure logic;
- component/render tests for states;
- interaction tests for behavior;
- accessibility automation for detectable issues;
- visual regression for layout/style regressions;
- end-to-end tests for critical user journeys.

Prefer queries by role/name/label to test IDs where practical.

Load `references/testing-and-visual-qa.md`.

### 18. Browser QA is mandatory when tooling exists

Run the UI and inspect it.

At minimum inspect loading, populated, empty, error, disabled/permission state where relevant, narrow mobile, desktop, keyboard focus, and reduced motion if motion exists.

Use `scripts/capture-ui`, `scripts/run-a11y`, and `scripts/run-lighthouse` when the host toolchain supports them. Check the browser console.

### 19. Final adversarial review

**Content**
- What happens with 2× longer text?
- Empty content?
- Huge numbers?
- Missing image?

**Interaction**
- Keyboard only?
- Touch?
- Double click/tap?
- Slow network?
- Rapid repeated action?
- Browser back/forward?

**Accessibility**
- Is focus visible and logical?
- Does every control have the right role/name/state?
- Can a screen reader understand status/error changes?
- Is motion optional where required?

**Responsive**
- Does the component adapt to its container?
- What happens at 200% zoom/reflow?
- Any horizontal overflow?

**State**
- Can impossible UI states occur?
- Can stale async results overwrite newer ones?
- Does optimistic rollback work?

**Security**
- Is untrusted HTML reaching a dangerous sink?
- Is sensitive information in the bundle/logs/storage?
- Is the UI pretending to enforce authorization?

**Performance**
- Did this add a heavy dependency for a small interaction?
- Is input responsive on slower hardware?
- Are media dimensions reserved?

**Public web**
- Is primary content semantic/indexable?
- Is title/heading/link structure meaningful?

## Senior-engineer rejection rules

Challenge or reject:
- div/span recreations of native controls without necessity;
- ARIA used to compensate for incorrect HTML;
- inaccessible click-only interactions;
- placeholder-only form labels;
- disabled focus outlines without replacement;
- derived React state stored unnecessarily;
- Effects used for ordinary event logic or derived values;
- props mirrored into state without intentional snapshot semantics;
- global state introduced without real coordination need;
- viewport-only component responsiveness when container-aware behavior is required;
- arbitrary values when a design system exists;
- redesigning an existing product while implementing a small feature;
- universal skeleton/spinner rules regardless of interaction;
- optimistic updates without rollback/error strategy;
- unsafe `innerHTML`/equivalent with untrusted data;
- public content hidden behind client execution without understanding crawlability;
- generated structured data that does not match visible content;
- fixed English date/number/currency formats in localized products;
- "passes axe" treated as proof of accessibility;
- "looks fine on my screen" treated as responsive/visual QA.

## Definition of done

A frontend change is done when applicable items are true:
- requirement and user task are clear;
- semantic structure is correct;
- project visual language is respected;
- all meaningful UI states exist;
- keyboard/focus behavior works;
- WCAG 2.2 AA concerns were handled proportionally;
- content survives realistic variation;
- responsive/container behavior is intentional;
- async failure and retry behavior are safe;
- frontend security boundaries are respected;
- performance impact is reasonable;
- public SEO/document semantics are correct when applicable;
- localization concerns are handled when applicable;
- tests cover important behavior;
- browser/visual QA was performed when tools were available;
- no known console errors or obvious regressions remain.

Use `checklists/page-definition-of-done.md` and `checklists/component-definition-of-done.md`.

## Context discipline

Load only relevant references. Do not fill the context window with every frontend topic for a simple component change.
