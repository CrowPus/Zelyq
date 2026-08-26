# Profile: Static / Public Web

## Typical gates

- lint/types/tests;
- production build;
- broken-link/content checks where useful;
- accessibility automation;
- bundle/performance budgets;
- preview deployment;
- browser smoke/E2E for critical routes.

## Deployment

Most static platforms can deploy atomically.

Still preserve:
- immutable build identity;
- preview vs production separation;
- environment secrets;
- rollback to known deployment.

Do not inject production secrets into client-side static bundles.
