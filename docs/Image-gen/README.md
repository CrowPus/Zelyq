# Image Studio — product understanding and implementation proposal

Status: original product proposal. See [implementation and setup](implementation.md) for the standalone implementation and remaining evaluation, and [agent integration](agent-integration.md) for the plan that connects the coding agent to it.  
Date: 2026-09-06.

## What we are building

Zelyq will have a dedicated **Image Studio** section. A user opens it, describes an image, clicks Generate, and receives an original AI-generated image they can preview, download, and revisit. The experience works independently of app creation and project conversations.

The first objective is to make this standalone experience reliable and produce strong images. Once it is working well, Zelyq's existing agent can call the same image generation service to create assets for apps. That integration is a later phase.

“The agent generates the image” describes the user experience. It does not require running the existing coding-agent loop for each image: the initial implementation can submit the prompt directly to an image model through a dedicated backend service. An optional prompt assistant can be added separately.

## Confirmed scope and proposed defaults

Confirmed from the request:

- A dedicated Image Studio entry inside Zelyq.
- Prompt-to-image generation as a standalone function.
- Strong image generation quality as a product priority.
- Integration into the existing agent after the standalone experience is right.
- Documentation and understanding before implementation.

Proposed defaults, still open for discussion:

- A signed-in user can generate without creating or selecting an app project.
- Start with a private, user-owned image library. Team sharing comes later unless it is required for launch.
- Begin with one image provider behind a replaceable adapter; select the provider through a focused quality evaluation.
- Start with one image per request and expose only settings supported by the selected model.
- Use server-managed credentials through the existing settings and secret-encryption patterns. The billing/credential ownership model still needs a decision.

## What exists in the repository

These findings come from the checked-in source, not a running-system verification.

| Area | Current implementation | Implication for Image Studio |
| --- | --- | --- |
| Web routing | [`App.tsx`](../../apps/web/src/App.tsx) uses a signed-in route gate with project, team, settings, and account pages. | Add a dedicated protected `/image-studio` route. |
| Navigation | [`AppShell.tsx`](../../apps/web/src/components/AppShell.tsx) provides the shared shell and primary rail. The rail is hidden on small screens. | Add an Image Studio entry and an accessible mobile entry. |
| API composition | [`app.ts`](../../apps/server/src/app.ts) registers Fastify routes and application services. Authentication identifies the caller; routes perform authorization. | Register image routes and a separate generation service here. |
| Shared contracts | [`packages/core/src`](../../packages/core/src) holds shared types and validation. | Define image requests, job states, assets, and capability descriptions here. |
| Database | [`packages/db/src`](../../packages/db/src) maintains SQLite and PostgreSQL schemas and repositories. | Add persistent generation/asset metadata and migrations for both dialects. |
| Credentials | [`settings.ts`](../../apps/server/src/services/settings.ts) and [`secrets.ts`](../../apps/server/src/services/secrets.ts) provide configuration and secret handling. | Reuse these patterns; image generation needs explicit capability and credential validation. |
| Uploads | [`attachments.ts`](../../apps/server/src/routes/attachments.ts) and its [service](../../apps/server/src/services/attachments.ts) store project-scoped conversation attachments outside project workspaces. | Useful storage precedent, but the existing routes require a project and are not a standalone image library. |
| Image tools | [`image-assets.mjs`](../../plugins/image-assets.mjs) retrieves stock photographs, inspects/resizes/optimizes images, and creates deterministic SVG placeholders. | These tools do not provide AI image generation. Preserve their distinct purposes. |
| Agent architecture | [`architecture.md`](../architecture.md) describes the model loop, server gateway, and runtime boundary. | Keep Studio independent; future project asset writes must go through `RuntimeDriver`. |

No standalone Image Studio route or image generation service was found in the inspected application code. Existing image inputs and stock retrieval should not be presented as evidence that generation already exists.

Storage boundary clarification: the architecture document broadly discourages filesystem access outside the runtime, but the attachment service explicitly distinguishes application data from project files. Studio image storage should follow the application-data pattern; later export into a project should use the runtime.

## The first user experience

1. Open **Image Studio** from navigation.
2. See a prompt field, a few useful example prompts, supported size/quality controls, and recent images.
3. Describe the subject, style, composition, or intended use. The original prompt remains visible and editable.
4. Click **Generate**. The server validates configuration, access, inputs, and limits before submitting work.
5. See an honest queued/generating/saving state. Do not invent a progress percentage if the provider offers no measurable progress.
6. See the finished image in a large preview with download, prompt/settings details, and “Generate again.”
7. Return later or refresh while generating; the job and saved results remain available.

The screen needs explicit empty, unavailable-provider, generating, success, rejected, and failed states. A failure retains the prompt and gives an actionable retry or configuration message. A placeholder or stock photograph must never stand in for a successful generation.

For the first release, “Generate again” creates a new request from the same prompt/settings. It does not promise an identical image or reference-based editing. Those are separate capabilities.

## What “powerful” means

Power should be measured through output quality and useful creative control, not just the number of exposed settings.

| Capability | Intended value | Delivery stage |
| --- | --- | --- |
| Strong prompt adherence | Respect subject, composition, color, style, and requested text. | Evaluate before selecting the launch model. |
| High-quality outputs | Useful photography, illustration, product imagery, and web graphics. | Standalone launch. |
| Supported sizes and quality | Fit the user's intended use without unsupported controls. | Standalone launch. |
| Saved history and downloads | Make completed work reusable and durable. | Standalone launch. |
| Optional prompt enhancement | Help users express visual intent while preserving their requirements; show the revision before use. | After the core flow. |
| Reference images and iterative editing | Refine an existing image or use visual guidance. | Next capability phase, subject to provider support. |
| Multiple candidates | Compare alternatives and choose a direction with clear cost implications. | Next capability phase. |
| Transparency, masked edits, expansion, upscaling | Support specific asset-production workflows. | Add individually after validating model support and demand. |
| Agent asset creation | Let the app-building agent request images and place selected outputs in projects. | **Built** — see [agent integration](agent-integration.md). Off per project until switched on. |

Do not assume every provider supports seeds, negative prompts, arbitrary dimensions, transparency, editing, or multiple outputs. The provider capability description should determine which controls the UI displays and which inputs the server accepts.

## Proposed technical shape

```text
Image Studio page
  → authenticated image API
    → ImageGenerationService
      → persistent jobs and asset metadata
      → image provider adapter
      → application asset storage

Later: agent tool → authorized server service → same generation workflow
                                           → explicit export via RuntimeDriver
```

Keep the first implementation within the existing web/server/core/db structure. A durable job runner can initially run in the server process with bounded concurrency; its jobs must live in the database. A separate worker can come later if load requires it.

Suggested implementation locations, all new unless described above:

- `apps/web/src/pages/ImageStudioPage.tsx` and focused Studio components.
- `apps/server/src/routes/images.ts` for authenticated HTTP endpoints.
- `apps/server/src/services/image-generation.ts` for validation and job orchestration.
- `apps/server/src/services/image-providers/` for provider-specific adapters.
- `apps/server/src/services/image-assets.ts` for generated asset storage and retrieval.
- `packages/core/src/images.ts` for shared schemas and capabilities.
- Repositories, schemas, and migrations in `packages/db` for jobs and assets.

The provider adapter should expose supported capabilities and normalize generation results/errors. Where a provider supports asynchronous operations, persist its operation identifier and support checking that operation. Avoid tying the service contract to a specific vendor's response shape.

### Proposed HTTP contract

These routes are a proposal, not existing endpoints.

| Endpoint | Responsibility |
| --- | --- |
| `GET /api/images/capabilities` | Return configured model choices and supported controls without exposing secrets. |
| `POST /api/images/generations` | Validate and persist a generation request; return `202` and a job ID. |
| `GET /api/images/generations` | Return paginated history belonging to the caller. |
| `GET /api/images/generations/:id` | Return job state, safe error details, and saved output references. |
| `GET /api/images/assets/:id` | Serve an authorized preview or download. |
| `DELETE /api/images/generations/:id` | Remove a completed history entry and its exclusively owned assets according to the retention policy. |

Use polling through the existing query layer initially. Stop polling terminal jobs and resume when reopening an active job. A streaming channel is optional later.

### Persistence and execution

Generation metadata should include ID, owner, original prompt, effective prompt if changed, provider/model, validated settings, state, timestamps, idempotency key, provider operation/request ID when available, safe error details, and reported usage/cost when available. Estimated and actual costs must be distinguishable; unavailable cost is not zero.

Asset metadata should include ID, generation ID, owner, storage key, MIME type, dimensions, byte size, and creation time. Keep image bytes in durable application storage, not database rows or public frontend assets. Save provider outputs before marking the job successful; temporary provider URLs are not durable history.

Initial job states: `queued → generating → saving → succeeded`, with explicit `failed` and `unknown` outcomes. `unknown` means a submission may have reached the provider but its result cannot yet be established.

- Persist the request before execution and use an owner-scoped idempotency key to prevent duplicate browser submissions.
- Claim jobs atomically; use leases or equivalent ownership so concurrent runners do not submit the same job.
- On restart, resume queued jobs. Reconcile interrupted work using provider identifiers when possible; otherwise surface an uncertain outcome instead of automatically submitting again.
- Retry transient failures only when doing so cannot duplicate a potentially billable generation. Do not retry validation failures or provider rejections automatically.
- If saving fails after generation, retry saving the same output where possible, rather than generating a replacement.
- Closing the page does not cancel generation. Add cancellation only with clearly defined provider behavior; local cancellation does not guarantee that billing stops.

### Access and operational requirements

Every history, status, asset, and deletion request must check ownership server-side. Use opaque IDs and application-generated storage paths. Keep provider credentials on the server, and redact credentials and sensitive provider payloads from logs.

Apply prompt/output size limits, per-user request limits, and bounded concurrency before making provider calls. Validate actual output image types and dimensions. If the adapter downloads provider URLs, restrict destinations and redirects to its expected hosts and reject private-network destinations. Keep provider rejection handling explicit.

Define retention, deletion, storage capacity, backups, and account-deletion cleanup before launch. If shared storage or team ownership is selected, update the access model before writing the routes.

## Provider selection and quality evaluation

No provider, model, price, or provider-specific capability is selected by this document. Current official API documentation and pricing must be verified during provider selection; existing chat-model connections do not establish image-generation support or entitlement.

Run a small fixed prompt suite covering photorealistic scenes, product shots, illustrations, web hero graphics, exact requested text, complex spatial composition, and portrait/landscape outputs. Repeat representative prompts to evaluate consistency.

Score prompt adherence, visual defects, text accuracy where requested, usability at the requested size, latency, failure rate, and cost. Review actual outputs with the product owner. Define acceptable scores and a request-cost envelope before selecting the launch model. Defer advanced features rather than representing unsupported options as functional.

## Delivery sequence and acceptance

1. **Settle product choices and provider evaluation.** Confirm ownership, credentials, initial capabilities, and the launch-quality bar. Verify current provider documentation and run the agreed prompt suite.
2. **Build one durable vertical slice.** Configure one provider; submit one prompt; persist the job and output; preview/download it in Studio.
3. **Complete the standalone product.** Add history, supported controls, responsive navigation, failure recovery, request limits, and deletion behavior.
4. **Improve creative capabilities.** Add reference editing, optional prompt enhancement, and other controls in response to quality evaluation and user needs.
5. **Integrate the agent.** Expose the same service through an authorized tool and explicitly export assets into a selected project via the runtime.

Standalone acceptance requires:

- A signed-in user can navigate to Studio and generate without an app project or an active coding-agent session.
- A real provider-generated image is saved, previewable, downloadable, and present after refresh/restart.
- Duplicate submission, rate limits, provider rejection, timeout, interrupted jobs, and storage failure produce clear states without silent duplicate generation.
- One user cannot read or delete another user's jobs or images.
- Unsupported settings are rejected before provider submission.
- The agreed quality suite meets the chosen launch bar.
- Route/service tests cover ownership, idempotency, failure recovery, and persistence; schema parity covers both databases; an end-to-end test covers prompt → result → refresh → download with a controlled provider adapter.
- A separate live-provider smoke test verifies the actual integration and output quality; mocked tests alone do not establish either.

## Decisions to settle before implementation

1. Should launch images be private to each user, or shared with a team?
2. Will users bring image API keys, or will the instance supply and pay for generation?
3. Is launch text-to-image only, or must reference-image editing ship at the same time?
4. Which matters most for the first model: maximum quality, lower cost, or speed—and what generation cost is acceptable?

The proposed starting point is a private standalone Studio, one evaluated provider, text-to-image generation, supported size/quality controls, durable history, and downloads. The service boundary makes room for stronger editing workflows and later agent use without coupling the initial experience to app creation.
