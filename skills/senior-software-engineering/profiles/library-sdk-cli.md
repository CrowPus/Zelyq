# Profile: Library, SDK, or CLI

## Public surface

Treat exported types/functions, CLI flags, config files, output formats, exit codes, environment variables, and documented behavior as contracts.

## Required lenses

- backward compatibility;
- precise public API documentation;
- error behavior;
- cross-platform/path behavior for CLI;
- stdin/stdout/stderr discipline;
- exit codes;
- configuration precedence;
- dependency footprint;
- installation/uninstall/update;
- examples;
- versioning/deprecation.

## CLI edge cases

- paths with spaces/Unicode;
- missing file;
- permissions;
- stdin pipe vs TTY;
- interrupted process/signals;
- existing output file;
- partial output;
- no network;
- non-zero child process;
- Windows vs POSIX behavior when supported.

## Versioning

If the project claims Semantic Versioning, identify the public API before deciding whether a change is patch/minor/major.

Load `references/api-and-contracts.md`.
