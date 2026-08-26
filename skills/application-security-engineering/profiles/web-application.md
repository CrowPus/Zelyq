# Profile: Web Application

## High-value areas

- authentication/recovery;
- authorization;
- sessions/cookies;
- CSRF for cookie-authenticated state changes;
- XSS/raw HTML;
- redirects;
- uploads/downloads;
- browser security headers;
- CORS;
- sensitive client data;
- admin/support UI;
- error leakage.

## Browser/server boundary

Assume:
- users can modify JavaScript;
- hidden fields can be changed;
- disabled controls can be re-enabled;
- API calls can be made outside the UI.

All critical controls must be server-side.

## Security headers

Review applicability of:
- CSP;
- frame-ancestors;
- HSTS;
- Referrer-Policy;
- content sniffing protections;
- cookie attributes.

Do not add headers blindly if they conflict with architecture; understand the policy first.

## Client-side storage

Review whether tokens/sensitive data are placed in:
- localStorage;
- sessionStorage;
- IndexedDB;
- URLs;
- logs/analytics.

Minimize exposure and understand XSS implications.
