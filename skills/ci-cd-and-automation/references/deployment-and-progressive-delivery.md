# Deployment and Progressive Delivery

## Choose strategy by risk

### Direct / atomic
Good for low-risk or platform-atomic deployments where rollback is immediate.

### Rolling
Replace instances gradually. Requires old/new compatibility during rollout.

### Blue-green
Maintain two environments and switch traffic. Fast rollback but may cost more and still needs data compatibility.

### Canary
Expose a limited cohort/capacity to new version and compare health before expanding.

### Feature flag
Separates code deployment from feature exposure. Useful for risky behavior changes and product rollout.

Flags need lifecycle:
create → test → staged enablement → full → remove.

## A canary needs a hypothesis

Define before deploy:
- target cohort/capacity;
- baseline/control;
- observation duration;
- health metrics;
- promotion threshold;
- rollback threshold;
- maximum rollout step;
- operator/automation ownership.

"Deploy to 10%, wait 15 minutes" is not enough if there is no defined signal.

## Progressive rollout

Google SRE recommends staged non-emergency rollout and monitoring during rollout.

Example:

```text
internal/1%
  ↓ health OK
5%
  ↓
25%
  ↓
50%
  ↓
100%
```

Percentages are illustrative. Risk, traffic volume, geography, and detection sensitivity determine stages.

## Deployment concurrency

Two production deployments can interact destructively.

Use concurrency controls so deployment state transitions are serialized when necessary.

For PR validation, canceling superseded runs is often desirable.

For production, understand whether pending deployment cancellation or ordered queuing is correct.

## Feature flags

Use flags to:
- decouple deployment/release;
- canary by user/tenant;
- rapidly disable risky behavior.

Avoid:
- permanent stale flags;
- security authorization implemented only through a client flag;
- flag combinations that create untested state explosion.

## Rollback vs roll-forward

Rollback is preferred when:
- old artifact remains compatible;
- data was not irreversibly transformed;
- recovery is faster/safer than patching.

Roll-forward may be required after:
- irreversible migration;
- external side effects;
- state newer code created that old code cannot understand.

## Configuration

Configuration changes can cause incidents just like binaries.

Version, review, validate, stage, observe, and roll back configuration.

Add sanity checks for dangerous magnitude changes.

## Sources

- https://sre.google/workbook/canarying-releases/
- https://sre.google/sre-book/service-best-practices/
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments
