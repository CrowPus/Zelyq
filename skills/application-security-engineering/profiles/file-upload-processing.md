# Profile: File Upload and Processing

## Threat surface

Review:
- upload;
- storage;
- preview;
- conversion;
- extraction;
- scanning;
- download;
- deletion.

## Required design decisions

Document:
- allowed file classes;
- maximum size/count;
- decompressed limits;
- serving policy;
- public/private ownership;
- parser/converter;
- malware scanning needs;
- retention.

## Isolation

High-risk parsers/converters should not run with unnecessary:
- filesystem access;
- network access;
- credentials;
- CPU/memory.

## Regression

Test:
- extension/content mismatch;
- oversized file;
- malicious filename/path;
- unauthorized download;
- archive path traversal/decompression bounds;
- active-content serving policy.
