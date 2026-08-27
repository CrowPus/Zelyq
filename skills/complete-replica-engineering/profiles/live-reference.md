# Profile: Live Reference

## Advantage
The browser can reveal actual:
- geometry;
- computed styles;
- fonts;
- responsive changes;
- interaction states;
- scroll behavior.

## Workflow
1. capture environment;
2. await stable render/fonts;
3. inventory page;
4. snapshot geometry/styles;
5. capture states;
6. resize/probe transitions;
7. implement;
8. diff repeatedly.

Do not copy source code from DevTools as the replication method. Inspecting rendered behavior is evidence; proprietary implementation remains separate.
