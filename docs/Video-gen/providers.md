# Video providers and capability plan

Status: adapters for Google and xAI are implemented against these findings. Account access and pricing are still unverified — no paid call has been made.  
Official documentation checked: 2026-09-07. Recheck model availability and request contracts when implementation begins.

## Provider direction

Plan for **Google and xAI** in the standalone release. Evaluate Google's current Omni model alongside Veo; use the adapter with a verified durable execution contract for the first Google integration. Do not infer access from a working image key, a chat subscription, or the presence of a provider in Zelyq's coding-model picker.

| Candidate | Verified documentation finding | Proposed Zelyq decision |
| --- | --- | --- |
| Google Gemini Omni Flash | Google's video overview recommends Omni as its default video family. | Include in the model evaluation; the recommendation is Google's, not a completed Zelyq quality assessment. [Google overview](https://ai.google.dev/gemini-api/docs/video) |
| Google `gemini-omni-1.1-flash` | The guide uses the Interactions API, supports landscape/portrait generation and image inputs, and describes iterative editing. | Verify submission, retrieval, storage lifetime, and background execution before enabling; a completed synchronous response alone does not establish crash recovery. [Omni guide](https://ai.google.dev/gemini-api/docs/omni) |
| Google Veo 3.1 | The detailed guide documents `veo-3.1-generate-preview`, long-running operations, 16:9/9:16, 4/6/8-second clips, native audio, image inputs, and frame/reference workflows. Some settings require 8 seconds. | A candidate for the first Google adapter because its operation polling is documented. Begin with text and starting-image modes; gate advanced combinations separately. [Veo guide](https://ai.google.dev/gemini-api/docs/veo) |
| xAI `grok-imagine-video-1.5` | The guide documents asynchronous requests, text/image/reference workflows, 1–15-second generation, multiple ratios, 480p/720p/1080p with mode restrictions, and optional silent generation. | Candidate for the second launch provider; verify text and starting-image modes and the exact model's constraints. [xAI video guide](https://docs.x.ai/developers/model-capabilities/video/generation) |
| OpenAI Sora | The API reference marks video creation deprecated and schedules permanent Sora API shutdown for September 24, 2026. | Exclude from a new launch integration. Reconsider OpenAI only if a supported replacement becomes available. [OpenAI reference](https://developers.openai.com/api/reference/typescript/resources/videos/methods/create) |

These findings do not establish pricing, regional availability, entitlement, or comparative quality for the intended account. Exact prices are deliberately not frozen into this proposal.

## Adapter-specific checks before implementation

- **Google Veo:** use the detailed REST/SDK contract rather than the overview's generic API description. The REST examples submit through `predictLongRunning` and retain an operation name. The guide describes a two-day download window; retrieve the completed output promptly into Zelyq storage. Verify combinations of mode, duration, resolution, and reference count. [Veo guide](https://ai.google.dev/gemini-api/docs/veo)
- **Google Omni:** test how an interaction is identified and retrieved during and after generation; confirm whether the chosen background/storage options preserve recovery. The guide also offers synchronous operation with storage disabled, which needs different failure handling. Advanced conversation editing should not dictate the first Studio UX. [Omni guide](https://ai.google.dev/gemini-api/docs/omni)
- **xAI:** persist `request_id` from `POST /v1/videos/generations`; query `GET /v1/videos/{request_id}`. Normalize pending, done, failed, and expired responses. Output URLs are temporary. Explicit ratios can stretch image inputs, so Zelyq must prepare and preview matching reference geometry. [xAI video guide](https://docs.x.ai/developers/model-capabilities/video/generation)
- **Every enabled model:** verify accepted image encodings, input dimensions/bytes, response media format, output retrieval authentication, URL hosts/redirects, cancellation semantics, idempotency support, timeouts, and rate limits. Record sanitized fixtures from the verified contract. Unverified features stay disabled.

## Capabilities are per model and mode

The proposed capability response should describe:

- Provider ID, model ID/label, configuration readiness, and any known availability reason.
- Modes such as `text-to-video` and `image-to-video`.
- Allowed ratios; duration choices/range/fixed value; resolution choices.
- Valid combinations, not just independent lists. A resolution may require a particular duration or disallow references.
- Reference roles, count, MIME types, byte limits, and dimension requirements.
- Audio behavior: always generated, optional, unavailable, or unspecified.
- Provider progress reporting, polling/retrieval support, and confirmed cancellation support.
- Optional price estimate metadata with currency, rate source, and verification date.

The browser derives controls from these capabilities. The server validates the complete selection against the same rules before making a billable request. Keep user-facing ratios and durations independent of vendor enum names; adapters translate them.

“Configured” means required settings are present. It must not imply the account has passed a paid generation test. A non-billable credential/model check may be offered where the provider supports one; any action that actually generates a clip must say so.

## Selection checkpoint

Before enabling a launch model, record its exact ID/API version, access result, supported request combinations, retrieval/recovery behavior, pricing source, and sample quality assessment. Choose the initial default using the [evaluation suite](delivery-plan.md#quality-evaluation), with Google and xAI both represented. Additional vendors can use the same interface later; no third-party plugin installation is required for this documentation phase.
