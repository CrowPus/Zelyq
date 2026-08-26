# Design Tokens

## Purpose

Tokens represent design decisions in a tool/platform-independent way.

Prefer semantic layers:

```text
primitive blue-600
  ↓
semantic action-primary
  ↓
component button-primary-background
```

Avoid components depending directly on arbitrary raw values when a semantic role exists.

## DTCG format

The Design Tokens Community Group published the stable 2025.10 Format Module for exchanging tokens across tools.

It defines:
- `$value`;
- `$type`;
- groups;
- aliases/references;
- composite types such as typography, border, shadow, transition, gradient.

Use DTCG-compatible structure when interoperability matters.

## Categories

Common token types:
- color;
- dimension;
- font family;
- font weight;
- duration;
- cubic bezier;
- number;
- border;
- shadow;
- gradient;
- typography.

## Naming

Name by meaning where possible:
- `color.text.primary`
- `color.surface.warning`
- `space.component.inline.sm`

not:
- `gray7`
- `box-padding-14`

Primitive scales can be descriptive; product code should favor semantic roles.

## Themes

Theme switching should change semantic mappings, not force component-specific hacks.

## Modes

Potential modes:
- light/dark;
- compact/comfortable;
- high-contrast;
- brand/customer themes.

Do not create modes without actual product need.

## Deprecation

Token systems evolve. Document aliases/deprecation rather than silently removing heavily used roles.

## Source

https://www.designtokens.org/TR/2025.10/format/
