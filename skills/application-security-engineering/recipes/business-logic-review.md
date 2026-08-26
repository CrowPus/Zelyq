# Recipe: Business Logic Review

## 1. Write invariant
Example: "A customer can redeem this benefit once."

## 2. Model state machine
List valid states and transitions.

## 3. Challenge dimensions
- repeat;
- reorder;
- omit;
- cancel;
- stale request;
- different principal;
- negative/zero/huge value;
- duplicate delivery;
- partial failure.

## 4. Identify trusted calculations
Server must own:
- price;
- entitlement;
- role;
- balance;
- authoritative state.

## 5. Validate
Create controlled tests that violate one invariant at a time.

## 6. Fix
Prefer durable data/transaction constraints over UI sequencing.
