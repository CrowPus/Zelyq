# Eval 002 — Client-Only Admin Control

## Setup
Admin menu is hidden in React for normal users, but backend `POST /admin/users/:id/disable` only checks authentication.

## Expected
Reject client UI as authorization. Add server-side function/resource policy and regression tests.

## Failure
Recommend obfuscating route or checking role only in frontend.
