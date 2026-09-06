# Image Studio implementation

Image Studio is implemented as a standalone signed-in page at `/image-studio`. It does not create an app project or run the coding-agent loop.

## Enable generation

1. Open **Settings → Image Studio** as an instance administrator.
2. Choose a default provider and add its image API key (OpenAI, Google, or xAI). The key is encrypted using the existing settings service.
3. Open **Image Studio**, enter a prompt, choose aspect ratio and quality, and generate.

Image generation is the first section in Settings. Studio also links directly to `/settings#image-generation`.

Alternatively, set `ZELYQ_IMAGE_API_KEY` (OpenAI), `ZELYQ_IMAGE_GOOGLE_API_KEY`, or `ZELYQ_IMAGE_XAI_API_KEY` in the server environment. The configured environment value takes precedence over the stored setting. Generation uses a dedicated credential; a chat subscription does not configure Studio. Calls are billed to the image API key's account.

Supported providers:

| Provider | Models | Controls |
| --- | --- | --- |
| OpenAI | GPT Image 2 | Square, landscape, portrait; low/medium/high quality; up to 3 reference images |
| Google | Nano Banana 2, Nano Banana Pro, Nano Banana 2 Lite | Square, landscape, portrait; native 1K output; up to 3 reference images |
| xAI | Grok Imagine Image 2.0 | Square, landscape, portrait; low/medium quality; native 1K output; prompt-only |

Choose a configured provider in Studio before generating. Each provider has an independent key and model setting. The default is controlled by `ZELYQ_IMAGE_GENERATION_PROVIDER` or Settings. This deliberately differs from `ZELYQ_IMAGE_PROVIDER`, which already configures stock-photo retrieval.

Provider/model choices are pinned to a persisted job. Changing the default cannot send an existing job or its credential to another provider. Unsupported quality controls are disabled or omitted in the UI and rejected by the API. Google and xAI outputs retain their actual dimensions rather than being resized to OpenAI dimensions. JPEG/WebP outputs are decoded and converted to PNG for consistent downloads.

Reference images are accepted as PNG, JPEG, or WebP uploads up to 8 MiB each. The server decodes and normalizes every reference to a private PNG before queueing the job. OpenAI jobs with references use the image edit endpoint; Google jobs include the references inline with the prompt. xAI currently rejects references at submit time because this version has no supported reference-image adapter for xAI.

API contracts were checked on 2026-09-06 against the official [OpenAI image guide](https://developers.openai.com/api/docs/guides/image-generation), [Google image guide](https://ai.google.dev/gemini-api/docs/generate-content/image-generation), and [xAI image guide](https://docs.x.ai/developers/model-capabilities/images/generation). Account access must still be verified with real provider credentials.

## Implemented behavior

- Desktop navigation and a mobile navigation entry.
- Prompt examples, a large result preview, prompt reuse, and PNG downloads.
- Professional Studio controls for provider capability, visual ratio selection, quality, and reference uploads.
- User-owned history with pagination, deletion, and ownership checks on every resource request.
- Persistent jobs with polling; refresh and navigation do not cancel work.
- One outstanding request per user, ten requests per rolling hour, and 200 undeleted library entries per user. These are initial fixed service limits.
- Two database-protected generation slots across server processes sharing the database.
- Owner-scoped idempotency keys. Reusing a key with different inputs returns a conflict; deleting a generation does not allow that key to submit again.
- Five-minute provider timeout. No automatic provider retries or replacement generations.
- Separate queued, generating, saving, succeeded, failed, and unknown states.
- Saving retries write the same provider result, up to three times.

## Persistence and deployment

Migration `0014_image_providers` adds the provider field, defaulting existing jobs to OpenAI. Migration `0013_image_studio` adds `image_generations` for both SQLite and PostgreSQL. Migration `0015_image_references` adds reference count and digest metadata. The server already runs migrations at startup. Jobs and the single output's metadata share one row for this release; image bytes live in application storage.

`ZELYQ_IMAGE_ASSETS_DIR` overrides the storage directory. By default it is `images/` beside the database (or the standard data directory for PostgreSQL). Back up this directory together with the database and encryption key. All API replicas must use the same image storage when sharing a database. Generated images and reference images are private authenticated assets, not public static files.

Completed images remain until the user deletes them or the account is deleted. Deletion removes the PNG and clears the prompt/error/usage from its history row. A minimal tombstone remains for request accounting and idempotency until account deletion. No automatic retention expiry is implemented. The per-user entry cap and per-image 20 MiB cap bound each library; operators must provision and monitor total instance storage as user counts grow.

A fixed ten-minute lease protects running jobs. After a crash, queued work resumes. An expired saving job recovers if its complete PNG and metadata are present; an expired provider submission becomes **Result unconfirmed**. It is never automatically resubmitted because the provider may already have charged for it. Recovery can therefore take up to ten minutes after an abrupt process stop. The current synchronous provider API adapter does not reconcile results with provider operation IDs.

## Validation commands

```sh
pnpm --filter @zelyq/core build
pnpm --filter @zelyq/db build
pnpm --filter @zelyq/server typecheck
pnpm --filter @zelyq/web build
pnpm --filter @zelyq/db test
pnpm --filter @zelyq/server test
pnpm exec playwright test --config apps/web/e2e/image-studio.config.ts
```

The dedicated browser test boots an isolated temporary database and a mock image provider. It exercises prompt submission, refresh during generation, reference-image upload, a decoded preview, download, mobile layout, deletion, and the absence of project creation. It never reads `.env` or calls a billable provider.

Backend tests cover ownership, idempotency, account cleanup, limits, rejected/invalid provider outputs, uncertain outcomes, storage failure, and interrupted-job recovery. A database test checks competing claims across independent connections. Schema parity covers the new table in both dialects; a live PostgreSQL instance is not required by these tests.

Validation completed during implementation: the initial server regression suite passed 228 tests; the dedicated Image Studio browser test passed; the independent-connection claim test and focused image service tests passed. Core/database builds, server type checking, and the web production build passed. The browser test was also visually checked at desktop and mobile widths.

## What still needs evaluation

The implementation is the standalone foundation. A live provider smoke test and the quality suite from the [product proposal](README.md) are still needed to judge generated-image quality, latency, and cost with the intended account. Mocked PNG fixtures establish application behavior, not model quality.

Agent integration is now built — see [agent integration](agent-integration.md). Multiple candidates, prompt enhancement, transparent backgrounds, upscaling, and team sharing remain future work. xAI reference-image support should be added only after its supported request contract is confirmed. The provider interface and generation service are separate from the page so these can be added without putting the coding-agent loop into Studio.

## Missing settings diagnosis

The previously running server process predated the Image Studio implementation. Its `/api/images/capabilities` returned 404 while `/api/settings` returned the normal authentication response. The page renders settings supplied by that backend, so a frontend build alone could not expose the new fields. The API process must load the updated code and migrations. The browser test now explicitly opens image settings, saves Google/xAI credentials, and generates through all three adapters using mocked provider responses.

The API was restarted on port 8081 after backing up the database to `data/backups/before-image-providers-20260906-173538.db`. Its image route now returns the expected authentication response instead of 404. The updated server suite passed 230 tests, and the browser flow passed across all three mocked providers, including Settings persistence and PNG conversion. Refresh an already-open browser tab to load the updated UI and settings.

### Second occurrence — reference images appeared inactive

The same stale-process failure recurred for reference images. The API process on port 8081 was started at 17:45:50, before the reference-image code was written: `image-providers/index.ts` (the `referenceImages` capability flags) at 17:59, `image-generation.ts` at 18:00, and `packages/core/src/images.ts` at 18:03. That process therefore served `/api/images/capabilities` without a `referenceImages` field. The page reads `Boolean(provider?.referenceImages)`, so the upload control rendered disabled with "Not available for this provider" — the code was correct and only the running process was old.

Migration `0015_image_references` had also never been applied. The database reported 16 migrations only after the restart; before it, the last applied stamp was `0014_image_providers` and `image_generations` had neither `reference_count` nor `reference_digest`.

The web build was not at fault: `apps/web/dist` was rebuilt at 18:05, after the page change, and the served bundle contains the reference upload control.

Resolved by backing up to `data/backups/before-image-references-20260906-192652.db` and restarting the API, which applied `0015` on boot. Verified afterwards: 16 migrations applied, both reference columns present, `/api/images/capabilities` registered (401 rather than 404), and the dedicated browser test passing.

Whenever image code changes, restart the API process. It runs without a watcher, so editing files alone changes nothing that is being served, and a capability the server does not report renders as a disabled control rather than an error.

### "Request body too large" on every real reference upload

After the restart the upload control was enabled, and every genuine upload then failed with **request body too large** (HTTP 413).

`POST /api/images/generations` carried an explicit `bodyLimit` of 64 KB. That was correct for a prompt-only request and was never revisited when reference images arrived. References travel as base64 inside the JSON body, so an 8 MiB image becomes about 11 MB of payload and three of them about 33 MB — several hundred times the route's ceiling. A route-level limit overrides Fastify's server-level one, so the 16 MiB server default never applied here; this was confirmed against Fastify directly rather than assumed.

The limit is now derived from `maxImageReferences` and `maxImageReferenceBytes`, the same constants the request schema validates against, plus a 1 MiB allowance for the prompt and JSON envelope. A separately chosen number is what let the route and the schema disagree in the first place.

The existing tests missed this because both the browser test and the backend reference test use the small generated fixture PNG, which fits inside any limit. `largeImageFixture` now builds a real, decodable PNG of a requested size using random pixels, since a gradient deflates to a few kilobytes and proves nothing about payload limits. A backend test submits three references at the documented 8 MiB ceiling and asserts the route does not answer 413. That test was confirmed to fail with 413 against the old limit before the fix was restored.

Verified after the fix: the full server suite passed 232 tests, server type checking passed, the browser test passed, and an 11 MB request against the running instance reached authentication instead of being rejected for size.
