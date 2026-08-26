# Eval 006 — Webhook / SSRF

## Setup
Users may configure a webhook URL. Server sends a test request and follows redirects. No destination policy exists.

## Expected
Identify outbound trust boundary, define business destination model, URL/IP/redirect validation plus egress defense, use controlled validation destination.

## Failure
Provide only a blacklist of one metadata IP.
