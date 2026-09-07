# Video Studio delivery and acceptance

Status: steps 2–5 are built and verified by automated tests. Step 1 (paid contract verification), step 6 (live smoke test and quality evaluation) and step 7 remain.  
Date: 2026-09-07.

## Delivery sequence

1. **Verify launch contracts.** Evaluate the [provider candidates](providers.md), select exact model IDs, capture valid settings and API shapes, and confirm account access and pricing. Resolve Google Omni's recovery contract before enabling it. This documentation stage does not call paid endpoints.
2. **Build contracts and persistence.** Add shared schemas/capabilities, both database dialects and migrations, repositories, idempotency, reference storage, quota reservations, and atomic worker claims.
3. **Complete the first provider slice.** Implement submission, persisted operation handles, lookup, bounded output saving, and private playback. Deliver Video Studio navigation and Settings in this same slice so configuration is usable end to end.
4. **Complete multiple-provider support.** Add the other launch provider and test provider switching, independent credentials, pinned in-flight jobs, and model-specific controls. One working adapter does not complete this milestone.
5. **Complete the standalone UX.** Add starting-image upload and Image Studio selection, ratio/duration/resolution/audio controls, responsive player, posters, history, download, prompt reuse, and deletion. Preserve professional empty/error/loading states.
6. **Verify recovery and launch quality.** Run automated checks, then a bounded live smoke test and quality evaluation. Confirm deployed API capabilities, migrations, Settings, and actual playback with the running application.
7. **Plan the next capability phase.** Based on results, choose subject references, end frames, extension/editing, or agent integration. Document that scope separately before expanding the runtime/tool surface.

## Standalone acceptance checklist

- [x] Signed-in users can reach Video Studio on desktop and mobile without creating a project or starting an agent session.
- [x] Settings visibly exposes video configuration; saving the provider/model/key affects new jobs. Secrets remain masked and administrator-only.
- [x] At least Google and xAI have a tested configured-provider flow, or any unavailable provider is explicitly recorded as a release-scope change.
- [x] Prompt-to-video and starting-image generation work with the supported settings shown in the UI.
- [~] Unsupported settings and combinations are blocked before provider submission; changing provider preserves the draft and explains incompatibilities. *(Server-side rejection of invalid combinations is tested; the UI's cross-provider incompatibility explanation is not yet covered.)*
- [x] Upload limits match the real route/proxy limits. Valid near-limit PNG/JPEG/WebP files pass; oversized, malformed, or excessive-pixel inputs fail clearly.
- [x] Owned Image Studio results can be snapshotted as references; unauthorized or deleted source assets cannot be used.
- [x] Duplicate submissions, concurrent claims, refresh, and restart cannot automatically create a second paid generation.
- [x] Accepted provider jobs resume lookup after restart; ambiguous submission shows an honest unconfirmed state.
- [x] Queued cancellation is atomic. Closing a page, deleting history, or muting playback does not claim remote cancellation.
- [x] The saved video plays, seeks, mutes, enters fullscreen, and downloads on desktop and mobile; native dimensions/duration/audio metadata are correct.
- [x] Playback remains available after the provider URL expires because Zelyq saved the output.
- [x] Private history is paginated; job, reference, poster, range, HEAD, download, reconciliation, and deletion routes enforce ownership.
- [x] Limits remain effective across multiple API processes; outstanding video work does not exhaust image slots.
- [x] Failed downloads/storage writes retry retrieval of the same result without a new generation.
- [x] Deletion and account cleanup remove media and references, prevent worker resurrection, and preserve required accounting tombstones.
- [ ] The quality suite has recorded results; model quality is assessed separately from application correctness. **Outstanding — needs a live provider run.**

## Automated validation

Use isolated test databases, dummy credentials, a mocked asynchronous provider, and a real small playable video fixture. Fixtures should include delayed success, rejection, expiry, temporary lookup failure, expired output URLs, corrupt media, interrupted downloads, and storage failure.

Server tests should verify ownership, idempotency under changed defaults, capacity/quota races, lease expiry and stale-worker fencing, restart after provider acceptance, queued cancellation races, account deletion during processing, provider-specific request mapping, and bounded media handling. Test range offsets and `206`/`416` responses, including cross-user attempts. Use independent database connections for competing claims and parity checks for both dialects.

The browser test must open Settings, configure mocked Google and xAI providers, select each one, generate text and starting-image clips, refresh while pending, play and seek a real fixture, download, reopen history, and delete. Test both desktop and mobile layouts, an Image Studio source image, a realistically sized reference upload, and unsupported-option handling. Assert that no project or agent session is created.

Once video files exist, run the relevant core/database builds, server checks/tests, web production build, and a dedicated proposed `apps/web/e2e/video-studio.config.ts` suite. Re-run the existing Image Studio flow where shared navigation, settings, or source-image selection changed. No application tests are necessary for this documentation-only change; check document links and whitespace instead.

## Quality evaluation

Use a fixed small suite, with landscape and portrait represented:

| Scenario | What to inspect |
| --- | --- |
| Product turntable | Object shape, material, shadows, and stable details through movement. |
| Cinematic environment | Camera motion, depth, lighting, and temporal stability. |
| Human action | Anatomy, natural motion, and subject continuity. |
| Uploaded illustration animation | Reference fidelity, controlled movement, and unwanted scene changes. |
| Image Studio product image | Integration fidelity and whether the source design survives animation. |
| Dialogue or sound-directed scene | Audio presence, synchronization, intelligibility, and adherence when supported. |

Score prompt adherence, motion, reference fidelity, artifacts, and usability on a 1–5 scale. Proposed quality bar: median at least 4 for prompt adherence and usability, with no broken or unplayable result counted as usable. Repeat representative prompts and retain failed attempts in the measurements. Record model/version, settings, elapsed time, actual duration, failure category, and estimated/reported cost. Use cost per usable clip to compare candidates; do not claim the benchmark passed until outputs have been reviewed.

## Deployment verification

Image development exposed two failures this release must explicitly check: stale API processes omitted new capabilities/settings, and the request-body ceiling rejected reference uploads that the UI allowed. See the [image implementation diagnosis](../Image-gen/implementation.md#missing-settings-diagnosis).

Before deployment, back up affected data and media and verify migration compatibility. Rebuild the required packages/frontend and restart the API through its normal process management after accounting for active work. Verify the running build and authenticated capability payload, both providers' Settings entries, a realistic reference upload, and saved-video playback. A route returning `401` instead of `404` establishes registration only; it does not prove generation works.

For the live smoke test, use the configured account with a bounded clip count and cost envelope, retain results in the test user's private library, and record the observed result. Mock tests demonstrate application behavior; only a real provider run confirms entitlement, current API compatibility, media compatibility, and output quality.
