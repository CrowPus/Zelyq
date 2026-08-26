# Exceptional Conditions and Resource Limits

## Why this matters

OWASP Top 10:2025 adds Mishandling of Exceptional Conditions.

Security must hold when:
- parameters are missing;
- dependencies timeout;
- retries happen;
- disk is full;
- a transaction partially fails;
- messages arrive twice/out of order;
- rate limit store is unavailable;
- parser receives huge/deep input;
- logging fails.

## Fail-open review

Find patterns such as:

```text
try privileged check
catch error
continue anyway
```

Security controls should generally fail closed, while availability-sensitive architecture may require carefully designed degraded modes.

Document exceptions.

## Transactions

For multi-step security-sensitive operations define:
- atomic boundary;
- compensation;
- retry semantics;
- idempotency;
- partial failure visibility.

## Resource limits

Bound:
- body/file size;
- array/list count;
- recursion/depth;
- pagination;
- database query scope;
- regex/runtime complexity;
- concurrent jobs;
- external requests;
- email/SMS;
- decompression;
- image/document transforms.

## Timeouts

External calls should have:
- connect/read/overall deadlines appropriate to the operation;
- cancellation propagation where supported;
- bounded retries.

Unlimited retries can amplify an outage.

## Dependency fallback

A fallback must preserve security.

Examples:
- auth provider unavailable should not authenticate everyone;
- permissions cache miss should not default to allow;
- signature verification failure should not accept unsigned data.

## Testing

Test exceptional paths directly.

They are often underrepresented in normal feature tests.
