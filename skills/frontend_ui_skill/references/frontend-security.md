# Frontend Security

## Trust boundary

Client code executes in a user-controlled environment.

Never rely on the frontend to enforce authorization, pricing, privileged state transitions, or secrets.

## XSS

Modern frameworks reduce many XSS risks through escaping, but escape hatches remain dangerous.

Avoid sending untrusted content into:
- `innerHTML` / equivalent raw HTML APIs;
- `document.write`;
- dynamic script/eval constructs;
- unsafe URL/attribute sinks.

OWASP recommends treating untrusted data as text and using safer DOM APIs such as `textContent` when appropriate.

Sources:
- https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html

## Rich HTML

If product requirements truly require user-controlled HTML:
- use a well-maintained sanitizer configured for the allowed content model;
- sanitize at the correct boundary;
- do not mutate sanitized HTML with unsafe string operations afterward;
- test malicious input.

## CSP / Trusted Types

Use CSP as defense in depth, not as the primary substitute for safe rendering. OWASP recommends strict CSP approaches when feasible.

Trusted Types can help enforce safer handling of DOM XSS sinks in supporting browsers/environments.

Source: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html

## Secrets

Anything delivered to the browser is discoverable.

Never ship:
- database passwords;
- private API credentials;
- service-account keys;
- unrestricted secret tokens.

Public client IDs/keys intended for browser use still require server-side authorization/rate/permission controls as designed by the provider.

## Storage

Do not use local/session storage for sensitive secrets merely because it is convenient. Choose session/token handling based on the application's threat model and backend architecture.

## URLs and redirects

Treat user-controlled URLs carefully. Restrict redirect targets and unsafe protocols where relevant.

## Dependency/browser APIs

Do not introduce third-party scripts casually. They execute with significant page capability and can affect privacy, performance, CSP, and supply-chain risk.
