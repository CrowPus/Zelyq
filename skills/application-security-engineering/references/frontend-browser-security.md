# Frontend and Browser Security

## Browser trust boundary

Client code is visible and modifiable by the user.

Never place authoritative:
- permission decisions;
- secrets;
- pricing integrity;
- tenant enforcement

only in client logic.

## XSS

Prefer framework safe rendering.

Review escapes/bypasses:
- raw HTML APIs;
- DOM sinks;
- dynamic script/style;
- unsafe URL protocols;
- rich-text rendering.

Sanitize trusted-rich-content use cases with a proven sanitizer.

## CSP

Content Security Policy is defense in depth.

A strong CSP can reduce XSS impact but should not replace safe rendering.

Consider Trusted Types for suitable applications.

## CSRF

Cookie-authenticated state-changing requests may require CSRF defenses depending on SameSite/cross-origin architecture.

Use framework/platform protections appropriately.

## Cookies

Sensitive session cookies generally need:
- Secure;
- HttpOnly;
- appropriate SameSite;
- narrow Domain/Path where relevant.

## Cross-origin

CORS is a browser read policy, not authentication.

Do not use permissive CORS as an authorization mechanism.

## Clickjacking

Protect sensitive UI against unauthorized framing using CSP `frame-ancestors` or equivalent where needed.

## Redirects

Validate post-login/return URLs.

Prefer relative or allowlisted destinations.

## Frontend secrets

Anything shipped to the browser should be treated as public to the user.

Public client identifiers are not secrets; private credentials must stay server-side.
