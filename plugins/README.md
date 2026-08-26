# Zelyq operator plugins

This directory is the complete, flat `ZELYQ_PLUGIN_DIR`. Every top-level `.mjs` file is a plugin
bundle loaded by Zelyq at boot. Shared implementation is under `lib/`, where the loader does not
scan for plugins.

Install dependencies once:

```bash
cd plugins
npm install
```

Configure the absolute directory and restart Zelyq:

```env
ZELYQ_PLUGIN_DIR=/absolute/path/to/zelyq/plugins
```

The directory contains 21 bundles exporting 76 tools for project intelligence, testing, static
analysis, browser QA, APIs, Git inspection, databases, design systems, image assets, documentation,
containers, deployment readiness, and external integrations.

Tests live outside this directory under `test/plugins/` and run with `npm test` from here.

External integrations use fixed project-runtime environment variables documented in the integration
test and individual tool descriptions. Tokens are never accepted as model inputs. All external
service tools are read-only.
