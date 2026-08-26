# Recipe: Security Regression Test

## Given
A confirmed security property violation.

## Create test

### Arrange
Create principals/resources at security boundary.

### Act
Perform the action that previously violated the property.

### Assert
Verify:
- operation denied or safely handled;
- protected data unchanged;
- no partial side effect.

## Examples

### Authorization
Tenant B cannot read tenant A object.

### Idempotency
Same key/request produces one side effect.

### Sanitization
Allowed rich content renders; dangerous active content does not execute/appear.

### Error handling
Dependency failure does not grant access or commit partial privilege.

## Durability

Name the test after the security property, not the old payload.
