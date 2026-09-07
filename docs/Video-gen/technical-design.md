# Video Studio technical design

Status: implemented. The routes, files, tables and settings below exist; where the build diverged from this design it is noted at the end.  
Date: 2026-09-07.

## Repository fit

Source inspection found the image contracts in [`packages/core/src/images.ts`](../../packages/core/src/images.ts), the service in [`image-generation.ts`](../../apps/server/src/services/image-generation.ts), routes in [`images.ts`](../../apps/server/src/routes/images.ts), and persistence in [`repositories/images.ts`](../../packages/db/src/repositories/images.ts). Video should follow those module boundaries while retaining its own lifecycle and media types.

| Planned location | Responsibility |
| --- | --- |
| `packages/core/src/videos.ts` | Request schemas, states, model capabilities, and public response types. |
| `apps/web/src/pages/VideoStudioPage.tsx` | Standalone composer, current job, player, and library. |
| `apps/web/src/components/video-studio/` | Focused input, reference, player, and history components as needed. |
| `apps/server/src/routes/videos.ts` | Authentication, input parsing, owner-scoped jobs/uploads/media routes. |
| `apps/server/src/services/video-generation.ts` | Submission, admission limits, job execution, polling, recovery. |
| `apps/server/src/services/video-providers/` | Capabilities, provider submission, lookup, and output retrieval. |
| `apps/server/src/services/video-assets.ts` | Private reference/output storage, bounded streaming, cleanup. |
| `packages/db/src/repositories/videos.ts` | Portable persistence and atomic transitions/claims. |
| Existing schemas, migrations, settings, route registration, navigation | Add video entries through the established extension points. |

Initially run a bounded worker in the API process, backed by database jobs. Use the same shared application-storage model as image attachments, outside project workspaces. Keep image and video queue capacity separate so a slow video cannot consume an image-generation slot. A separate worker process is a later scaling option.

## Settings from the first slice

Add a visible **Video Studio** group beside Image Studio in Settings and support `/settings#video-generation`. Update the actual group rendering and hash navigation; adding backend definitions alone is not the whole UI change.

Proposed setting names:

| Setting | Environment fallback | Purpose |
| --- | --- | --- |
| `videoProvider` | `ZELYQ_VIDEO_GENERATION_PROVIDER` | Default provider. |
| `videoGoogleApiKey` | `ZELYQ_VIDEO_GOOGLE_API_KEY` | Dedicated Google video credential. |
| `videoGoogleModel` | `ZELYQ_VIDEO_GOOGLE_MODEL` | Enabled Google model/default. |
| `videoXaiApiKey` | `ZELYQ_VIDEO_XAI_API_KEY` | Dedicated xAI video credential. |
| `videoXaiModel` | `ZELYQ_VIDEO_XAI_MODEL` | Enabled xAI model/default. |
| `videoHourlyLimit` | `ZELYQ_VIDEO_HOURLY_LIMIT` | Per-user submission allowance. |
| `videoConcurrency` | `ZELYQ_VIDEO_CONCURRENCY` | Instance provider-job capacity. |
| Storage configuration | `ZELYQ_VIDEO_ASSETS_DIR` | Private application-data directory. |

Use the existing encrypted settings service, administrator access, masked secrets, and documented environment precedence. Dedicated video fields can contain a credential from the same provider account as images, but there is no implicit credential fallback. Show whether an environment value locks a field. Ordinary users can choose configured providers without reading or changing credentials.

Snapshot provider, model, capability version, and effective settings on submission. A changed default affects new jobs. Bind lookup/download to the original provider account; retain a secure credential-version reference or pause reconciliation on incompatible credential rotation. Never send a job or secret to another provider as automatic failover.

## Proposed HTTP contract

All endpoints require authentication and ownership checks. IDs in a request never establish access by themselves.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/videos/capabilities` | Configuration readiness, models, supported combinations, limits. |
| `POST /api/videos/references` | Bounded multipart image upload; return a private reference ID and preview metadata. |
| `POST /api/videos/references/from-image` | Validate ownership of a completed Image Studio generation and snapshot its bytes as a video reference. |
| `GET /api/videos/references/:id` | Authorized reference preview. |
| `DELETE /api/videos/references/:id` | Delete an unattached upload; reject deletion while a job retains it. |
| `POST /api/videos/generations` | Validate, reserve limits, persist job/reference links; return `202` and a job. |
| `GET /api/videos/generations` | Cursor-paginated private history. |
| `GET /api/videos/generations/:id` | Current state, safe error, actual output metadata, application asset links. |
| `POST /api/videos/generations/:id/reconcile` | Request lookup of the existing provider operation; never create a replacement. |
| `POST /api/videos/generations/:id/cancel` | Cancel a locally queued job; reject after submission unless provider cancellation is implemented and confirmed. |
| `GET /api/videos/assets/:id` | Authorized playback/download with HTTP range support. |
| `HEAD /api/videos/assets/:id` | Authorized media length/type headers. |
| `GET /api/videos/assets/:id/poster` | Authorized poster when available. |
| `DELETE /api/videos/generations/:id` | Delete a terminal library entry and exclusively owned media. |

The submit contract contains `provider`, `model`, `mode`, `prompt`, `aspectRatio`, `durationSeconds`, `resolution`, optional `audio`, role-tagged `referenceIds`, and a UUID `idempotencyKey`. Fields may be omitted only when the server resolves and persists a capability-defined default. Reject unknown fields and invalid combinations; distinguish `start-frame` from future subject/style references.

Prefer reference IDs over base64 embedded in the submission. Derive multipart limits from shared constants, bound decoded pixel count, normalize permitted PNG/JPEG/WebP inputs, and validate both uploaded and normalized byte sizes. Proposed initial limit: one starting image, up to 8 MiB, subject to a smaller provider limit. Bound and rate-limit unattached uploads as well as jobs.

Copy an Image Studio result into video-owned storage before accepting it as a reference. Deleting the source image must not break an accepted video job. Snapshot reference digests in the request identity and retain inputs for explicit generation reuse until the video entry is deleted.

## Provider interface and execution

The adapter exposes capability validation, `submit`, `lookup`, and `retrieveOutput`, plus optional confirmed cancellation. Submission returns either an operation handle or a completed output descriptor. Only advertise restart reconciliation when the provider handle can actually retrieve that job. Avoid SDK helpers that hide submission and polling behind one unresolved promise unless the handle can be persisted separately.

```text
Video Studio → authenticated video routes → VideoGenerationService
                                            ├─ persistent jobs and quota reservations
                                            ├─ provider submit / lookup / retrieve
                                            └─ private references / video / poster
```

Proposed main lifecycle:

```text
queued → submitting → generating → saving → succeeded
   └→ cancelled          failures → failed
             ambiguous outcome   → unknown
```

`unknown` means the outcome is unconfirmed, not that the provider failed. It can return to `generating` or `saving` after reconciliation of the same operation. Record provider rejection, provider expiry, and storage/retrieval failure as distinct error codes. Keep a temporary poll error separate from the generation outcome.

Execution rules:

1. Validate ownership, references, credentials, request combinations, and limits; atomically reserve quota and persist the job before execution.
2. Enforce a unique `(ownerId, idempotencyKey)` and compare a canonical request digest. Duplicate browser requests return the same job; changed inputs conflict. Default-setting changes do not alter replay identity: resolve omitted values against the existing job on replay.
3. Atomically claim work using short renewable leases, a fencing token, and database-protected capacity. Renew while submitting or retrieving; only the current lease holder can commit a transition.
4. Persist the `submitting` intent before contacting the provider. Persist the returned operation handle immediately. There is still a crash window between provider acceptance and saving its handle; use provider idempotency only if verified. Otherwise mark that window unconfirmed instead of resubmitting.
5. Schedule lookups with persisted `nextPollAt`, backoff/jitter, and provider rate-limit guidance. Release the worker lease between polls, while retaining the provider-capacity reservation for an outstanding operation.
6. On restart, resume queued jobs and look up accepted jobs by their handles. Read-only lookup and retrieval may retry transient failures. A polling timeout does not authorize another paid submission.
7. Retrieve and save the same completed output using bounded streaming and an atomic finalization step. Mark success only after usable media and metadata are durable. Retry storage/download without generating a replacement.
8. Treat missing handles, unresolved remote state, and exhausted retrieval windows explicitly. Preserve accounting for potentially charged jobs. Permit user-triggered reconciliation without permitting resubmission under the old key.

Initial timeout proposal: separate bounded HTTP calls from a 30-minute active polling window. After that window, display “Taking longer than expected” and reduce polling frequency. Move to `unknown` only when status cannot be established; bound reconciliation by verified provider retention. Do not automatically release a possibly running provider slot just because a local lease expired. Provide an operator resolution path for irreconcilable jobs and record the decision.

Queued cancellation races with claiming through one conditional database transition. After provider submission, no cancel button may claim billing has stopped without confirmed support. Account deletion disables future work and discards later results from outstanding operations even if the provider cannot cancel them.

## Persistence

Use portable types and transactions for SQLite and PostgreSQL, with both migrations and schema parity tests. Choose the next migration number from the repository at implementation time.

| Record | Required data |
| --- | --- |
| `video_generations` | ID, owner, original/effective prompt, provider/model/API or capability version, validated settings, request digest/key, status, timestamps, safe error code/message, optional provider progress, deletion marker. |
| Job execution fields | Provider operation handle, credential reference, attempt/submission timestamps, lease holder/expiry/fencing version, next poll, reconciliation deadline, capacity reservation. |
| `video_assets` | Owner, generation, private storage key, MIME/container/codec, bytes/checksum, actual duration, width/height, audio presence, optional poster key. |
| `video_references` and job links | Owner, private storage key, MIME/dimensions/bytes/digest, input role/order, optional source image ID, expiry for unattached uploads. |
| Accounting | Reserved/actual storage, request allowance, requested seconds, estimated cost and rate version, reported usage/cost when available. |

Use tombstones for deleted request keys and accounting until account cleanup; deletion must not reset rate limits. Keep bytes out of database rows. Never store raw API keys or signed provider URLs in public job responses. Protect any short-lived retrieval locator needed for recovery and remove it after finalization.

## Media delivery and retention

Stream provider bytes to a bounded temporary file, validate the container and stream metadata, then finalize atomically. Do not trust a filename, Content-Type header, or an MP4 signature alone. Test playback of the selected providers' actual codecs in supported browsers. Use a maintained media probe with timeout/resource limits; if a local executable is required, package and document it rather than assuming the host has it.

Start with a browser-playable MP4 output contract. If a provider format needs conversion, explicitly budget and sandbox that processing before enabling it. Do not rename incompatible media to `.mp4`. Poster creation can fail independently without losing a valid video; show a labeled fallback thumbnail.

Playback must stream from private application storage with authenticated single-range requests, `206`/`Content-Range`, correct full-response headers, and `416` for unsatisfiable ranges. Authorize `HEAD`, preview, and download too. Avoid loading a whole video into a JavaScript buffer or issuing API keys to the browser. Restrict provider retrieval hosts, redirects, and resolved addresses; do not implement arbitrary URL fetching.

Completed videos and attached references remain until deletion. Proposed orphan-upload expiry is 24 hours. Library deletion removes video, poster, and unshared inputs; retries clean up failed filesystem deletions. Account deletion also removes pending uploads and prevents workers from recreating deleted assets. Back up video storage with the database and encryption key. API replicas sharing a database need shared media storage.

## Limits and cost

Initial proposed operator-configurable defaults, to validate against the chosen models:

- One outstanding generation per user; two outstanding provider jobs per instance, separate from images.
- Five submitted jobs per user per rolling hour, including potentially charged unconfirmed requests.
- Maximum 15 requested seconds per clip; each model can impose a smaller limit.
- At most 100 undeleted jobs and 5 GiB of retained video data per user, including references/posters.
- Maximum 200 MiB output per job, plus separately bounded inputs and poster data. Reserve the maximum allowed storage before submitting and settle to actual bytes afterward.
- At most ten unattached reference uploads per user; include them in storage accounting.

Enforce admission and storage reservations atomically across API processes. Keep image allowances independent. Report remaining allowance and clear limit errors before submission. A request-count limit bounds calls, not monetary spend; a price estimate requires a verified rate and must be labeled estimated. Missing cost is “unavailable,” never zero. Hard currency budgets require explicit rate accounting and are a later extension unless launch requirements demand them.

## Future agent boundary

After standalone acceptance, an authorized agent tool can call the same service, record source/project/session provenance, poll an existing job, and export the selected asset through `RuntimeDriver`. It must not receive provider keys or bypass user/instance limits. Define a separate video permission and budget; the existing image permission does not authorize video spending. This proposal adds no agent tool or project toggle.

## Where the build diverged from this design

Recorded so the document stays an honest description of what exists, rather than of what was intended.

**No poster route.** `GET /api/videos/assets/:id/poster` is not implemented and no poster is generated. Extracting a frame needs a media tool in the request path, which this design itself said to budget and sandbox before enabling. History cards and the player use a labelled placeholder instead, which the product document already permits. The route can be added later without changing the stored contract.

**One provider module rather than a directory of adapters.** `video-providers/index.ts` holds the capability table, both adapters and the guarded download. It is one file because the two adapters are small and share the request-shaping and error-mapping helpers; splitting it per provider is a refactor to do when a third arrives, not a change in the boundary the design describes.

**`retrieveOutput` is a module-level `downloadVideo` rather than an adapter method.** Retrieval is the same for both providers — an HTTPS fetch restricted to that provider's own hosts, with redirects and resolved addresses checked and bounded streaming to a temporary file. Putting it on each adapter would have duplicated the guard, which is the part that must not vary.

**Reference deletion is best-effort from the composer's side.** The route still refuses to delete an input a saved video retains (409). What changed is the UI: detaching a starting image from the draft no longer depends on that call succeeding, because deleting a video also deletes its inputs, and a composer still holding the old reference would then get a 404 and refuse to clear — leaving the user unable to pick a different image at all.

## Verification status

Automated coverage is in `apps/server/test/videos.test.ts` (11 tests) and `apps/web/e2e/video-studio.spec.ts`. Together they cover both providers end to end, durable playback with authenticated ranges and downloads, near-limit multipart uploads, idempotency and invalid combinations, resumed polling after restart, ambiguous outcomes retaining capacity without resubmitting, retrieval retries, lease fencing across independent database connections, account deletion during generation, unsafe download destinations and byte ranges, atomic queued cancellation, and private paginated history.

Not covered: the UI's cross-provider incompatibility explanation, and anything requiring a paid call — account access, real API compatibility, media compatibility and output quality. The [delivery plan](delivery-plan.md) tracks those.
