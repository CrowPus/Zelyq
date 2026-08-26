# Secure Code Review Checklist

## Architecture
- [ ] Entry points identified
- [ ] Trust boundaries identified
- [ ] Sensitive data/actions identified

## Identity
- [ ] Authentication paths
- [ ] Authorization policies
- [ ] Tenant isolation
- [ ] Session/token lifecycle

## Input/sinks
- [ ] SQL/query
- [ ] shell/process
- [ ] raw HTML/template
- [ ] filesystem/path
- [ ] outbound HTTP
- [ ] deserialize/parser
- [ ] object/property binding

## State/failure
- [ ] transactions
- [ ] retries
- [ ] idempotency
- [ ] concurrency
- [ ] partial failure
- [ ] fail-open behavior
- [ ] resource limits

## Data
- [ ] secrets
- [ ] crypto
- [ ] logs
- [ ] exports/files
- [ ] third-party transfers

## Evidence
- [ ] static findings validated
- [ ] sibling patterns searched
- [ ] fix regression exists
