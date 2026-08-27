# Accessibility and Semantic Parity

A production replica should match visible/interactive behavior without copying invalid semantics.

## Preserve
- visible focus treatment;
- keyboard behavior;
- labels;
- headings;
- landmark meaning;
- dialog/menu semantics;
- form relationships.

## Improve invisible defects carefully

If reference uses non-semantic clickable `<div>` but behaves like a button, implement a real button while matching appearance.

Do not intentionally reproduce:
- missing keyboard access;
- absent labels;
- inaccessible dialog focus;
- invalid heading hierarchy

merely for DOM similarity.

## WCAG
Use WCAG 2.2 as the default web accessibility baseline unless project requirements differ.

## Visual changes
If accessibility requires visible change (for example an otherwise invisible focus state), preserve the reference as much as possible while meeting production requirements and document the necessary deviation.
