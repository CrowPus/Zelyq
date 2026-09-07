# Video Studio — product understanding and proposal

Status: implemented and verified by test. A live provider run and the quality suite are still outstanding — see [delivery and acceptance](delivery-plan.md).  
Date: 2026-09-07.

## What we are building

Zelyq will have a standalone **Video Studio**. A signed-in user opens it, describes a scene and its motion, optionally supplies an image, chooses supported generation settings, and receives a video they can play, download, and revisit.

This follows the Image Studio approach: understand the product, document the design, implement the standalone experience, verify it end to end, then consider agent integration. The standalone experience is built and covered by automated tests. No paid provider call has been made yet, so account access, real API compatibility and output quality are still unproven.

Read these documents in order:

1. This page: product scope, creative controls, and user experience.
2. [Providers](providers.md): current API findings, candidate providers, and capability rules.
3. [Technical design](technical-design.md): reuse, API, jobs, settings, storage, and recovery.
4. [Delivery and acceptance](delivery-plan.md): implementation sequence and verification criteria.
5. [Frame export](frame-export.md): splitting a clip into the image sequence a scroll-scrubbed hero needs.

## What carries over from Image Studio

Image Studio already provides the pattern for signed-in navigation, provider configuration in Settings, a dedicated generation service, private user-owned assets, durable history, reference uploads, and downloads. Its agent integration is also now documented as built. See [Image Studio implementation](../Image-gen/implementation.md) and [image agent integration](../Image-gen/agent-integration.md).

Video can reuse these boundaries and product conventions. Its execution and media handling need their own implementation: long-running provider jobs, resumable status checks, larger files, playable codecs, seeking, audio, and temporary output retrieval. Image's synchronous `generate → bytes` adapter and fixed job lease should not become the video contract.

## Scope and working defaults

Confirmed direction:

- A new standalone generation feature inside Zelyq, following the image development process.
- Documentation before implementation.

Proposed first-release scope, based on the completed image experience:

- **Video Studio** in desktop and mobile navigation, at `/video-studio`.
- **Settings → Video Studio**, with independent provider keys, model choices, and limits.
- Multiple provider adapters in the launch scope; the first completed adapter is an implementation milestone, not the whole product.
- Text-to-video and image-to-video, one clip per request.
- Visual ratio selection, clip duration, resolution, and audio controls where supported.
- Private reference upload; selection of an owned Image Studio result as a starting image.
- Persistent generation status, a large video player, history, download, and deletion.
- No project or coding-agent conversation required.

Proposed defaults are one outstanding job per user, landscape output, a short clip, and a moderate supported resolution. Resolve the actual duration/resolution from the selected model's capability record; never pass an image model's dimensions or quality enums to a video API. Initial limits are specified in the [technical design](technical-design.md#limits-and-cost).

Later scope: multiple subject references, first-and-last-frame direction, extension, editing, multiple candidates, prompt assistance, and agent integration. A full timeline editor, clip assembly, voice cloning, and publishing to social platforms are separate products and are outside this first release.

## The standalone experience

1. Open **Video Studio**. If no provider is configured, show a clear setup state with a link to `/settings#video-generation`; non-administrators see who can configure it.
2. Choose a configured provider and an administrator-enabled model. Show supported features before the user writes a prompt.
3. Choose **Text to video** or **Animate image**. For the latter, upload an image or select one from the user's Image Studio library, then describe how it should move.
4. Choose supported ratio, duration, resolution, and audio settings. Show the complete selection beside Generate, including an estimated price when a maintained rate is available.
5. Generate. Preserve the prompt and inputs while showing queued, submitting, generating, or saving status. Show elapsed time; show a percentage only if the provider supplies meaningful progress.
6. Play the saved result with seeking, volume/mute, fullscreen, and download. Display actual duration, dimensions, audio presence, provider/model, and the original prompt.
7. Reopen history after refresh or navigation. **Generate again** copies the settings into the composer; another click creates a new billable request. It does not promise an identical result.

Errors preserve the user's work and distinguish invalid inputs, unavailable credentials, provider rejection, provider failure, delayed status, and a result that could not be confirmed. Closing the browser does not cancel a job. Removing a saved clip is not provider cancellation.

## Creative controls

| Control | First release | Behavior |
| --- | --- | --- |
| Prompt | Yes | Describe subject, action, camera movement, lighting, style, timing, and sound. Provide a few editable examples. |
| Provider/model | Yes | Use video-specific configuration and tested model capabilities. |
| Aspect ratio | Yes | Visual landscape/portrait buttons; square or other ratios only on compatible models. |
| Duration | Yes | Show a discrete selector, bounded range, or fixed value according to model support. |
| Resolution | Yes | Show only valid choices for the current mode and duration. Record actual output dimensions. |
| Starting image | Yes | Preview the image and any required crop before submitting. Never silently stretch it. |
| Audio | Where supported | Distinguish generated audio, optional silent generation, and playback mute. Muting the player does not remove audio from the download. |
| Style/camera examples | Yes | Insert visible, editable prompt text; do not imply exact camera paths or guaranteed loops. |
| Subject/style references | Later | Keep these separate from a starting frame; enable only tested provider modes. |
| Last frame, extension, editing | Later | Separate workflows with their own capability constraints and costs. |
| Seed, negative prompt, FPS | Only after verification | Omit unsupported controls. A vendor's capability is not automatically shared by other models. |

Changing provider or mode must explain incompatible settings or references and require the user to resolve them before generation. Keep the prompt and reference previews intact while doing so.

## Visual design

Use the existing Zelyq shell, typography, colors, spacing, and form components. On desktop, use a focused composer beside a large preview/player, with a thumbnail library underneath. On mobile, place the composer, player, and history in one readable column; keep Generate reachable without horizontal scrolling.

The player should preserve the clip's aspect ratio, use a poster when available, and avoid autoplay with sound. History cards show a poster or a clearly labeled video placeholder, duration, status, and provider. Use an accessible native player initially; a custom control bar is optional only if keyboard and assistive-technology support is retained.

Treat empty, uploading, queued, generating, saving, ready, failed, and unconfirmed states as designed screens. Disable duplicate submission while retaining prompt editing. Use thumbnails instead of loading every library video's full media file.

## What good video generation means

Evaluate prompt adherence, motion quality, subject consistency across frames, reference fidelity, camera behavior, and audio synchronization where requested. Also measure latency, failure rate, and cost per usable clip. A playable file proves the application works; it does not prove the model produces professional results.

The first release is complete when the standalone workflow works across the selected providers, Settings is discoverable and effective, inputs match the controls offered, and completed videos remain playable after refresh and server restart. The [delivery plan](delivery-plan.md) makes these checks explicit.
