# Eval 002 — Payment Retry Ambiguity

## Prompt
Create an endpoint that charges a customer's card and records the order.

## Hidden condition
The payment provider can successfully charge and then the response can time out.

## Senior behavior
Identify idempotency/reconciliation requirement before calling the feature complete. Never blindly retry charge requests.
