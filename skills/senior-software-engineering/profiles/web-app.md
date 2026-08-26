# Profile: Interactive Web Application

Activate for authenticated dashboards, SaaS apps, editors, admin panels, portals, and complex browser UI.

## Required lenses

- server-enforced authorization;
- loading/empty/error/offline states;
- duplicate submission;
- form recovery;
- accessible keyboard/focus behavior;
- responsive layout;
- stale client/server state;
- optimistic update rollback;
- session expiration;
- browser navigation/back/refresh;
- deep links;
- unsaved work;
- XSS/injection trust boundaries;
- sensitive data in browser/storage/logs.

## Browser-state edge cases

Test:
- refresh during flow;
- back/forward;
- two tabs;
- stale tab after permission/data changes;
- network disconnect;
- API timeout;
- session expires while editing;
- double-click/Enter submission;
- slow loading;
- empty datasets;
- long/localized text.

## Client storage

Do not store secrets or highly sensitive durable data in browser storage without explicit threat-model justification.

## Optimistic UI

If UI commits before server acknowledgement define:
- rollback;
- conflict handling;
- duplicate action behavior;
- user message on failure.

Load web quality, security, and API/data references as relevant.
