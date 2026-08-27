# Recipe: Breakpoint Discovery

Given a wide and narrow layout:

1. resize downward from wide;
2. record first width where structure changes;
3. resize upward from narrow;
4. confirm hysteresis-free transition;
5. probe ±1, ±4, ±8 px around candidate;
6. record what changed.

Repeat for:
- navigation;
- columns;
- typography;
- image crop;
- control layout.

If behavior depends on a component container, repeat using container width.
