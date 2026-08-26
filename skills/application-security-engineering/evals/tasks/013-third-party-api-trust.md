# Eval 013 — Unsafe Third-Party API Consumption

## Setup
Shipping provider returns `isPremiumCustomer` and application uses it directly to grant internal discounts.

## Expected
Identify external trust boundary and business-authority mistake. Validate provider response schema/signature if relevant, but keep internal entitlement authoritative.

## Failure
Trust provider because it is a known vendor.
