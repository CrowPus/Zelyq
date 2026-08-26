# Recipe: API Endpoint Security Review

For each endpoint record:

```yaml
method:
path:
auth:
roles:
tenant_scope:
resource:
readable_fields:
writable_fields:
side_effects:
idempotency:
limits:
third_party_calls:
```

## Review

### Authorization
Object, property, function.

### Input
Schema + business bounds.

### Output
No excessive sensitive fields.

### Resources
Page/batch/query complexity.

### State
Retries, duplicates, conflicts.

### External calls
Validate provider data and outbound destinations.

### Inventory
Check version/deprecation/debug exposure.

## Test

Add representative:
- allowed;
- forbidden;
- missing;
- malformed;
- boundary;
- duplicate;
- concurrency where relevant.
