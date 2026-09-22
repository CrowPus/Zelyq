# Probe an integration before you write it

A connector written from memory is a guess. Boards get renamed, APIs change shape, SDKs rename
parameters. The agent in case study 001 shipped Lever connectors for three companies that return
404 and a Gemini call shaped from memory; none had ever been fetched.

## The routine (one `run_command`, a few seconds)

1. **Fetch the real endpoint from the sandbox** with the simplest client available (`curl`,
   `python -c "import urllib.request …"`, `node -e`). Confirm the status code, the content type, and
   the top-level shape. If it 404s or needs a credential you do not have, say so in the table
   (BLOCKED, with what is needed) — do not invent a substitute.
2. **Read the installed SDK's real signature**, not the one you remember: `python -c "import
   inspect, pkg; print(inspect.signature(pkg.Client.method))"` or the package's own type stubs.
   One real call with a tiny payload proves the call shape and the response parsing.
3. **Record a trimmed fixture**: two or three real records, secrets and personal data removed,
   long fields cut, saved under the tests (`backend/tests/fixtures/<source>_<name>.json`). Note the
   date in the connector's docstring ("shapes observed on <date>").
4. **Write the connector against the fixture**, then the contract test: fetch → parse → normalise →
   duplicate handling → failure handling (404, 429, 5xx, malformed JSON) → schema change made visible.
5. **Run it live once** (`discover --source X`, `client.test()`) and put the real count in the
   evidence cell.

## What "not configured" looks like

An integration whose credential is missing:
- reports `configured: false` from a status/health endpoint and the settings page;
- refuses the action with a coded error (`INTEGRATION_NOT_CONFIGURED`) that names the setting;
- never returns simulated success, sample records or a "demo" result on the production path.

The UI renders the feature with an empty state that links to the settings form. The settings form
has a real **Test connection** button that performs a real connect/auth and shows the real result.
