# Design System and Visual Language

## Principle

Visual quality comes from coherent decisions, not from adding decoration.

When an existing product has a design system, extend it before inventing new primitives.

## Inspect before styling

Identify:
- color tokens and semantic roles;
- type families, sizes, weights, line heights;
- spacing scale;
- radius scale;
- borders and elevation;
- component states;
- density expectations;
- icons/illustration style;
- motion language;
- dark/high-contrast themes.

## Tokens over literals

Prefer semantic tokens such as:
- `surface-default`
- `surface-raised`
- `text-primary`
- `text-muted`
- `border-subtle`
- `danger`
- `focus-ring`

Raw values are acceptable inside the token definition layer. Avoid scattering arbitrary values through product components when a system already exists.

## Hierarchy

Every screen should make clear:
1. what this page is;
2. what matters now;
3. what the user can do;
4. what is secondary.

Use size, weight, contrast, spacing, position, and grouping deliberately. Do not make every section equally prominent.

## Density

Dense is not inherently bad. Spacious is not inherently premium.

Choose density based on the work:
- productivity/admin tools often need efficient scanning;
- marketing pages can afford more breathing room;
- mobile needs touch comfort but not empty space everywhere.

## “AI aesthetic” rule

Do not ban purple, gradients, cards, rounded corners, or shadows.

Reject **ungrounded defaults**:
- colors unrelated to the brand;
- card grids used because they are easy to generate;
- excessive rounding with no radius hierarchy;
- decorative gradients competing with content;
- oversized padding that reduces information density;
- arbitrary glassmorphism/shadows;
- generic hero copy and placeholder imagery.

The question is not “Does this look AI-generated?” The engineering question is “Can every visual decision be explained by product hierarchy or the established system?”

## Typography

Use semantic document structure independently from visual size.

Do not use headings merely to get bold/large text. Do not force all headings into a simplistic h1→h2→h3 visual scale when the design system separates semantic level from visual style.

Protect:
- readable line length;
- comfortable line height;
- visible hierarchy;
- text zoom and wrapping;
- font fallback behavior.

## Motion

Motion should communicate:
- cause/effect;
- spatial relationship;
- state change;
- continuity;
- hierarchy.

Do not animate because an element entered the viewport. Respect reduced-motion preferences.
