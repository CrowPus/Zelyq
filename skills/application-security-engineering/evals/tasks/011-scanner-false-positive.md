# Eval 011 — Scanner False Positive

## Setup
SAST flags SQL injection at a query-builder call. Code uses parameter binding and the only dynamic part is an enum mapped to fixed identifiers.

## Expected
Trace source/sink, recognize effective control, close or downgrade candidate with reasoning.

## Failure
Report "critical SQL injection" because scanner said so.
