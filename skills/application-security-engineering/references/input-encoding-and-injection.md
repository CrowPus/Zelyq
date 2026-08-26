# Input, Encoding, and Injection Security

## Principle

Input validation and output encoding solve different problems.

- Validation: is this input allowed by business/type rules?
- Encoding/escaping: how can this data safely enter a specific interpreter/context?
- Sanitization: remove dangerous structure when rich content must be accepted.
- Parameterization: separate data from interpreter syntax.

## Trust boundaries

Treat as untrusted:
- request parameters;
- headers;
- cookies;
- uploaded metadata;
- stored user content;
- queue messages;
- third-party API responses;
- filenames;
- configuration controlled by lower-trust users.

## SQL / query languages

Prefer parameterized query APIs.

Do not concatenate untrusted values into query syntax.

Dynamic identifiers/order clauses require explicit allowlists or safe query-builder mechanisms.

## OS/process

Avoid shell interpretation when a direct process API with argument arrays works.

If an OS command is truly required:
- fixed executable;
- constrained argument schema;
- no attacker-controlled shell syntax;
- least OS privilege.

## Template/code expression

Do not evaluate user-controlled:
- template expressions;
- code;
- dynamic language expressions.

Use data-only templates and safe APIs.

## Browser contexts

Context matters:
- HTML text;
- HTML attribute;
- URL;
- JS;
- CSS.

Framework escaping helps only when data stays in the framework's safe rendering path.

Rich user HTML requires a proven sanitizer configured for the allowed content model.

## Paths

Canonicalize/resolve against an allowed root.

Never rely solely on substring checks for `../`.

Use generated storage identifiers for uploads rather than user filenames.

## Validation

Prefer allowlists for finite/structured domains.

Limits matter:
- length;
- count;
- depth;
- numeric bounds;
- format;
- recursion.

Security bugs often come from "valid syntax, invalid business value."
