# Typography

## Purpose

Typography should first support:
- legibility;
- hierarchy;
- tone;
- content density;
- localization.

Brand expression comes after readable information.

## Typeface count

Use few typefaces. Apple HIG recommends minimizing the number because excessive typefaces weaken hierarchy and consistency.

Common system:
- one primary family;
- optional display/editorial family;
- monospace only for code/data where useful.

## Type roles

Prefer semantic roles:
- display;
- page title;
- section heading;
- body;
- label;
- helper;
- caption;
- numeric/data.

Do not map roles directly to HTML heading levels in every implementation; content hierarchy and visual role are related but distinct.

## Scale

Use a deliberate type scale. It can be modular or custom, but differences should create hierarchy rather than arbitrary jumps.

## Line length

Long-form reading benefits from constrained measure. Operational data, labels, and tables have different needs.

Do not force the same max width on every text type.

## Weight

Avoid ultra-light body text. Weight affects legibility, especially at small sizes.

## Large text

Design must survive user text enlargement.

Apple HIG emphasizes preserving hierarchy and reducing truncation at large Dynamic Type sizes. On the web, test zoom/reflow and user font settings.

## Numbers

Use tabular figures where numeric columns/counters need stable comparison.

## Localization

Fonts must support required scripts and diacritics.

Avoid pairings whose brand value disappears in non-Latin locales without a fallback strategy.

## Review

- Is body text comfortable?
- Does hierarchy remain with color removed?
- Is truncation necessary?
- Does long localized copy break components?
- Are font files/performance reasonable for the product?
