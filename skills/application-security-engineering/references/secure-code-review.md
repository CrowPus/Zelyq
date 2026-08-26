# Secure Code Review

## Why manual review matters

Automated tools find patterns. Manual review understands:
- business intent;
- trust;
- authorization;
- state transitions;
- cross-file data flow;
- compensating controls.

OWASP's Code Review Guide emphasizes context as the core value of white-box review.

## Review order

### 1. Architecture
Understand boundaries and sensitive flows.

### 2. Entry points
Where can untrusted data enter?

### 3. Security middleware
Authentication, authorization, validation, rate controls.

### 4. Sensitive sinks
- SQL/NoSQL;
- shell/process;
- template engines;
- file paths;
- browser HTML/JS;
- deserialization;
- outbound HTTP;
- cryptographic operations;
- privileged mutations.

### 5. State
Transactions, queues, caches, retries, optimistic concurrency.

### 6. Exceptions
What happens on error?

## Source-to-sink tracing

For a candidate:
1. identify attacker/user-controlled source;
2. follow transformations;
3. identify validation/encoding/authorization;
4. identify dangerous sink/action;
5. determine reachable conditions;
6. identify compensating controls.

Do not flag a string function solely by name.

## Structural searches

Useful searches:
- raw SQL execution;
- command execution;
- `innerHTML` equivalents;
- open redirects;
- filesystem path joins;
- URL fetch clients;
- broad ORM create/update from request body;
- token verification;
- permission decorators;
- upload handlers;
- secrets/config reads.

Use structural/AST tools when available because plain grep misses language structure and creates noise.

## Review comments

A security review comment should explain:
- risk;
- control expectation;
- exact code path;
- safer pattern.

Avoid vague "possible security issue" comments.
