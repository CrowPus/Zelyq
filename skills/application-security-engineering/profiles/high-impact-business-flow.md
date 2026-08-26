# Profile: High-Impact Business Flow

Use for:
- payments;
- refunds;
- credits;
- inventory;
- quotas;
- approvals;
- entitlement;
- billing;
- coupon/promotion;
- value transfer.

## Start with invariants

Examples:
- debit/capture at most once;
- refund <= captured amount;
- quantity never below zero;
- approver cannot approve own restricted request;
- credit cannot be minted by retry;
- price used for settlement comes from trusted server calculation.

## Abuse review

Test reasoning around:
- duplicate;
- concurrent;
- reordered;
- stale;
- negative;
- huge;
- cancelled;
- partial;
- cross-account.

## Auditability

High-value state changes need useful audit trails.

Do not log payment credentials or secrets.
