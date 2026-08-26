# SSRF and Outbound Network Security

## Threat model

Any feature that causes the server to fetch/connect to a user-influenced destination can cross network trust boundaries.

Examples:
- webhooks;
- URL previews;
- image import;
- PDF generation;
- callbacks;
- repository import;
- federated integrations.

## Preferred design

If business logic allows, use an allowlist of approved:
- hosts;
- domains;
- schemes;
- ports.

OWASP's SSRF Prevention guidance treats allowlisting as the preferred case when destinations are known.

## Validation considerations

A secure design must reason about:
- URL parser ambiguity;
- scheme;
- hostname;
- resolved IP;
- IPv4/IPv6;
- private/loopback/link-local/reserved ranges;
- DNS changes/rebinding;
- redirects;
- proxies;
- credentials embedded in URLs;
- alternative schemes.

Do not rely on a single regex.

## Redirects

If redirect following is unnecessary, disable it.

If necessary, validate every hop against the same policy.

## Network architecture

Application-layer validation is stronger when paired with network egress controls.

Restrict workloads so they cannot reach sensitive internal/control-plane endpoints unless required.

## Cloud metadata

Use cloud-specific defenses such as hardened metadata service configuration where available, but do not treat them as the only SSRF control.

## Validation

A safe security test should prove prohibited reachability with controlled/internal test endpoints where possible, not by touching unrelated sensitive infrastructure.
