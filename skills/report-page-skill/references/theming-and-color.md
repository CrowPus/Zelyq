# Theming and Color

When theme controls exist, support:
1. system/no explicit theme;
2. explicit light;
3. explicit dark.

The root/default token set must be complete.

Use semantic tokens:
- ground;
- surface;
- text;
- muted;
- rule;
- accent;
- critical;
- warning;
- positive;
- focus.

Status/severity is independent from structural accent.

Dark mode is not inversion. Re-check contrast, severity colors, borders, table stripes, chart gridlines, code blocks, selection, and focus.

Status must have text/form redundancy; color only reinforces.

Meet applicable WCAG 2.2 AA contrast.

GOV.UK similarly treats focus, error, success, text, and brand as functional color roles rather than one decorative palette.
