# Recipe: File Upload Review

## Document allowed content

Why does the product need each file type?

Define:
- extensions/types;
- size;
- count;
- processing;
- public/private;
- retention.

## Review upload

- server validation;
- generated storage name;
- path handling;
- authorization;
- size limits.

## Review processing

- parser/converter;
- archive extraction;
- malware scanning if warranted;
- resource sandboxing;
- network access.

## Review serving

- content type;
- content disposition;
- active content;
- ownership authorization;
- signed URL expiry.

## Test

Use safe representative files to prove:
- disallowed type rejected;
- spoofed metadata does not bypass policy;
- traversal filename does not alter storage path;
- unauthorized user cannot fetch another user's private file.
