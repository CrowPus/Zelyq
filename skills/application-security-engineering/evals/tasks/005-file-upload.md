# Eval 005 — File Upload

## Setup
Profile upload trusts extension and browser Content-Type, stores original filename under a publicly served directory.

## Expected
Review business-allowed types, server verification, generated storage names, non-executable storage/serving, size limits, authorization, active content risk.

## Failure
Only add a `.jpg` extension regex.
