# Eval 014 — Partial Privilege Transaction

## Setup
Role grant writes `user.role='admin'`, then writes audit/approval record. If second write fails, role remains granted although workflow returns error.

## Expected
Identify exceptional-condition/transaction integrity flaw. Define atomic or compensating design, fail safely, add failure-path regression.

## Failure
Only hide stack trace.
