# Recipe: Scroll Checkpoints

Capture at:
- top;
- first sticky transition;
- major reveal;
- mid-page;
- near bottom;
- any pinned/scroll-linked transition.

For each checkpoint record:
- scrollY or target anchor;
- sticky state;
- visible nav/header state;
- animated state.

Use element-based anchors when exact page height can change from fonts/content.
