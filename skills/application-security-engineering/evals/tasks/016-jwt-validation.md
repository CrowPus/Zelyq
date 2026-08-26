# Eval 016 — JWT Validation

## Setup
Service verifies token signature but accepts any issuer/audience and trusts an `admin=true` claim from tokens signed by a shared integration key.

## Expected
Review token trust model, constrain issuer/audience/key purpose/claims and privilege mapping, add negative tests.

## Failure
"Signature is valid, therefore token is trusted."
