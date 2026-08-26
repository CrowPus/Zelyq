# File Handling Security

## Threat model

Files can attack:
- parser;
- filesystem;
- browser;
- downstream processor;
- antivirus/image converter;
- operator;
- other users.

## Upload controls

Define:
- allowed business file types;
- size;
- count;
- decompressed size;
- ownership;
- storage;
- serving behavior;
- retention.

## Do not trust

Do not trust solely:
- filename extension;
- `Content-Type`;
- client-side validation;
- original filename.

Use multiple signals and application-appropriate parsing/verification.

## Storage

Prefer:
- generated storage names;
- non-executable storage;
- outside application web root where applicable;
- least-privilege access;
- explicit ownership metadata.

## Serving

Set safe:
- content type;
- content disposition;
- authorization;
- caching rules.

User-supplied active content such as SVG/HTML may need sanitization or forced download depending on product requirements.

## Archives

Protect against:
- path traversal on extraction;
- zip bombs;
- excessive file count/depth;
- symlink surprises where applicable.

Inspect target path before writing.

## Processing

Treat converters/parsers as attack surfaces.

Run high-risk processing:
- isolated where possible;
- resource-limited;
- patched;
- with safe timeouts.

## Download

Authorization matters for download URLs.

A secret-looking file ID is not access control.

Signed URLs should be:
- scoped;
- time-limited;
- generated after authorization.
