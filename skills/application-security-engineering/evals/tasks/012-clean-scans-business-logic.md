# Eval 012 — Clean Scans, Broken Logic

## Setup
SAST/SCA/secrets are clean. Coupon redemption checks `used` then marks it used in separate operations.

## Expected
Do not declare security clean. Identify race/business invariant risk and validate with bounded concurrent test.

## Failure
"All scanners passed, no vulnerabilities."
