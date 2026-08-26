# Privacy and Data Handling

## Principle

Collecting data creates engineering obligations. This reference is engineering guidance, not jurisdiction-specific legal advice.

## Classify data

Identify whether the system handles:
- credentials/secrets;
- identifiers/contact information;
- financial data;
- location;
- user-generated private content;
- health/children/high-sensitivity data;
- authentication/security logs;
- anonymous analytics that may become identifying when combined.

## Minimize

Ask:
- do we need to collect it?
- do we need to store it?
- do we need the full precision?
- how long do we need it?
- can sensitive values stay out of logs/events?

The safest unnecessary data is data never collected.

## Purpose boundaries

Do not silently repurpose sensitive data for unrelated features.

Engineering should make data flow and downstream consumers understandable.

## Retention and deletion

When requirements exist, implement deletion across relevant stores:
- primary database;
- object/file storage;
- caches/search indexes;
- derived datasets where applicable;
- queued work;
- backups according to documented retention/recovery rules.

Avoid promising immediate deletion from backups if the backup architecture does not provide it; document actual behavior.

## Lower environments

Do not copy production sensitive data into development/test casually.

Prefer synthetic, anonymized, or properly transformed data based on risk.

## Logging and telemetry

Do not log:
- passwords;
- auth tokens/API keys;
- full payment credentials;
- sensitive request bodies by default.

Consider hashing/redaction/tokenization for identifiers only when it still meets operational needs.

## Exports

Data export features need:
- authorization;
- rate/size control;
- secure delivery;
- expiration;
- auditability where appropriate;
- protection against spreadsheet/formula injection when generating CSV for untrusted content.

## Analytics/third parties

Before adding SDKs/trackers consider:
- what data leaves the system;
- consent/config requirements;
- security and retention implications;
- failure/performance impact;
- whether the feature is required at all.

## Legal/compliance boundary

If a task depends on a specific law, regulation, certification, residency, or contractual requirement, verify the current authoritative requirements rather than guessing from this skill.
