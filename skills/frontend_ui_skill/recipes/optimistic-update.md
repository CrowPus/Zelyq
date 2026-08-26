# Recipe: Optimistic Mutation

Use when immediate feedback materially improves UX and rollback is safe.

Sequence:
1. cancel/coordinate conflicting fetches;
2. snapshot previous state;
3. apply optimistic change;
4. send mutation;
5. on failure restore/reconcile;
6. communicate error without losing user context;
7. refetch/reconcile authoritative server result when needed.

Do not optimistically show irreversible financial/security-sensitive completion before authoritative success unless the product protocol explicitly supports it.
