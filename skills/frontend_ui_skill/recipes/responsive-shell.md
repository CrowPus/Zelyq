# Recipe: Responsive Application Shell

## Goals
- primary navigation remains discoverable;
- content width/density adapts;
- fixed/sticky chrome does not cover focus/content;
- mobile navigation does not trap scrolling;
- deep links/back button continue to work.

## Pattern

Use normal document flow for the main content. Treat sidebar/navigation collapse as a product decision, not only a CSS breakpoint.

For reusable panels/cards, prefer container queries when their behavior depends on allocated space rather than viewport width.

## QA
- narrow portrait;
- short landscape;
- desktop with sidebar;
- browser zoom;
- keyboard focus through header/sidebar/content;
- mobile menu open/close/focus restore.
