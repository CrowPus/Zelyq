# Agent image generation — implementation plan

Status: implemented. Verified by test and against a running instance; a live provider call through the agent is still outstanding.
Date: 2026-09-06.
Follows [the standalone Studio implementation](implementation.md).

## What we are adding

The coding agent can create original images for the app it is building, and can pull images out of the user's Studio library into the project. Everything the agent generates lands in the same library the user already sees, and none of it happens unless the user has switched the capability on for that project.

Four requirements from the request, and where each is answered:

| Requirement | Answer |
| --- | --- |
| The agent can generate images | `generate_image` tool, routed through the server over a session bridge |
| The agent can put images into its project | `output_path` on generation, plus a separate `place_generated_image` tool |
| Agent images show up in Image Studio | One library. The server writes the row with `owner_id` = the signed-in user, so Studio already lists it |
| A button that allows the agent to generate | Persisted per-project permission, off by default, checked when the session's bridge token is minted |

## The decision that shapes everything else

**The agent never talks to an image provider, and never touches the image database.** It asks the Zelyq server, and the server generates.

`ToolContext` is deliberately narrow — "a tool gets no ambient access to the filesystem, the network, or the database". The repository already solved this exact problem once, for Supabase: the server mints a random session-scoped token, the tool presents it to `/api/internal/supabase/*`, and the server performs the privileged call while holding the credential. `SupabaseBridge.mint(sessionId, projectId, userId)` returns `null` when there is nothing to bridge, and [session.ts:1513](../../apps/agent/src/session.ts#L1513) then hides the tools that would refuse anyway.

Image generation copies that shape exactly, as `ImageBridge`. Doing it this way gets four things for free rather than by construction:

- The image API key stays on the server. The agent process never sees it.
- The grant carries `userId`, so the generated row is owned by a real person — which is precisely what makes it appear in that person's Studio.
- Every limit, ownership check, idempotency rule and failure state in `ImageGenerationService` applies to the agent unchanged. There is no second code path to keep honest.
- The permission toggle needs no enforcement of its own. Off means no token; no token means the tools are not even offered to the model.

The alternative — giving the agent an API key and letting it call OpenAI or Google directly through the runtime's `curl`, the way `fetch_reference_image` reaches Pexels — was rejected. It would put a billable credential inside the sandbox that runs untrusted project code, and it would produce images that exist only as files in a project, invisible to Studio, unowned, uncounted, and unbilled to anything we can show the user.

## Flow

```text
model calls generate_image
  → tool POSTs to the server with the session bridge token
    → server resolves token → { projectId, userId }
      → ImageGenerationService.submit(userId, input)   ← same service Studio uses
        → provider adapter → PNG → ImageAssetStore
        → image_generations row, owner = userId, source = "agent"
  ← tool polls until terminal
  ← server returns the PNG plus a small preview
    → tool writes the PNG into the project via runtime.writeFile(..., "base64")
    → tool returns the preview to the model so it can see what it made
  → the row is already in the user's Studio library
```

## Data model

One migration, `0016_agent_images`, both dialects, with snapshots, journal entries, and an updated parity test.

On `image_generations`:

| Column | Purpose |
| --- | --- |
| `source` | `studio` or `agent`. Defaults to `studio`, which is what every existing row is |
| `project_id` | Which project the agent was building. Empty for Studio work |
| `project_name` | The project's name at generation time |
| `session_id` | The conversation that asked for it |

`project_id` is a plain column with **no foreign key**, and `project_name` is a snapshot rather than a join. Deleting a project must not delete a user's images or blank out where they came from — the library is the user's, and it outlives any one project. `messages` already takes this approach for the same reason ([sqlite.ts:235](../../packages/db/src/schema/sqlite.ts#L235)).

On `projects`:

| Column | Purpose |
| --- | --- |
| `image_generation_enabled` | The permission. Integer/boolean, default `0` — off |

## The permission

**Per project, persisted, off by default, flipped by any member of the project's team.**

Per project rather than per instance or per user, because "this project needs original artwork" is a property of the work. Persisted rather than per conversation — Engineer Mode and Architect Mode are deliberately per-conversation toggles that reset, but those only change how the agent thinks. This one authorises spending real money, so it must be a deliberate act the user can see is still in effect tomorrow.

A team member can flip it, not only an instance administrator. An administrator already controls the thing that matters at instance level: whether an image API key exists at all. Anyone who can run the agent can already spend model tokens; images are the same kind of decision.

Two places, one state:

- **In the chat toolbar**, beside the existing mode toggles in `ChatPanel` — discoverable at the moment someone asks for a picture and finds the agent cannot make one.
- **In project settings**, as the durable record of what this project is allowed to do.

When the instance has no image provider configured, the toggle renders disabled and explains why, linking to `/settings#image-generation`. A control that silently does nothing is worse than one that says who can fix it.

Enforcement is a single line at [gateway.ts:387](../../apps/server/src/ws/gateway.ts#L387): mint the image token only when the project's flag is on and a provider is configured. Turning the permission off takes effect on the next session.

A grant already in flight keeps working until it expires. `SupabaseBridge.revokeSession` exists and is tested, but nothing in the server calls it — tokens today are bounded only by their twelve-hour TTL and by being replaced when a session re-mints. `ImageBridge` has the same method and the same gap. Worth stating rather than claiming a revocation that does not happen; wiring both into session teardown is a small follow-up, and not one this feature should quietly pretend it already did.

## The tools

Three, all hidden unless `imageBridge` is present.

### `generate_image`

Creates an original image and, when given a path, writes it into the project.

```ts
{
  prompt: string,          // what to make, 1–8000 chars
  output_path?: string,    // e.g. src/assets/hero.png — must end .png
  size?: "1024x1024" | "1536x1024" | "1024x1536",
  quality?: "low" | "medium" | "high",
  reference_paths?: string[],  // up to 3 project files to guide it
}
```

`reference_paths` is how the agent uses reference images: it names files already in the project, the tool reads them through the runtime and forwards them as references. The agent never handles base64 by hand, and the 8 MiB and count limits are the ones the schema already enforces.

Returns to the model a short factual line and a **downscaled preview**, not the full PNG. The server produces the preview with the sharp it already uses in `normalize.ts`. Returning the image at all is deliberate and follows `fetch_reference_image`'s reasoning — an agent that cannot see what it generated will write a caption describing something else. Returning the *full* image would spend megabytes of context on pixels the model does not need.

### `place_generated_image`

Copies an image that already exists in the library into the project. No provider call, no cost.

```ts
{ image_id: string, output_path: string }
```

This is the half of the request that says "take image we have generated to its project" — including images the user made themselves in Studio, before the agent was ever involved.

### `list_generated_images`

Returns recent library entries — id, prompt, size, when, and which project made it — so the agent can reuse an existing image instead of paying to make a near-duplicate. This is the cheapest way to make the feature smart: the first thing the agent should do when it needs a hero image is check whether one already exists.

All three are governed by the **same single toggle**. Listing and placing cost nothing, so a case exists for letting them run always. They are gated anyway because the library is the user's private image collection, and a project agent should not be able to enumerate it by default. One switch, one sentence to explain, nothing surprising behind it.

## Generated art versus real photographs

The agent will now have two ways to obtain an image, and choosing wrong produces confident nonsense. `fetch_reference_image` retrieves real, licensed photographs; `generate_image` invents pixels.

The rule, stated in both tool descriptions and the prompt:

- A real place, person, company, product, landmark, or anything the copy asserts is real → `fetch_reference_image`. A generated "Kyoto in autumn" is not a photograph of Kyoto, and captioning it as one is a lie the user will ship.
- Original illustration, icon, texture, pattern, abstract or hero artwork, a brand-specific look, anything stock does not carry → `generate_image`.
- Never generate a real company's logo or mark.
- Never describe a generated image as a photograph of a real subject.

This extends the honesty the placeholder path already enforces, where a missing provider writes a labelled grey SVG that says outright it is not a photograph rather than guessing silently.

## Limits, cost, and a collision in the current code

`submit()` rejects a request when the owner already has one in flight:

```ts
if (await this.store.images.active(ownerId))
  throw new ZelyqError("conflict", "Your current image is still generating. …");
```

That is right for a person clicking Generate twice. It is wrong across two paths: if the user is generating in Studio when the agent submits — or the agent submits twice in one turn — one of them fails for a reason that is not the user's fault and that they cannot see.

Three changes:

1. **The agent's submit waits instead of failing.** On that conflict the bridge endpoint retries with backoff for a bounded period before giving up. The user-facing Studio behaviour is untouched.
2. **The hourly cap stays shared and per-user.** It is the cost control; giving the agent its own budget would quietly double what an instance can spend. But `HOURLY_LIMIT = 10` was chosen for a person clicking a button, and an agent building a landing page may legitimately want six images while its user is also experimenting. It becomes a setting with a raised default rather than a constant compiled into the service.
3. **A per-session cap.** No conversation may generate more than a fixed number of images, independent of the hourly cap. A model in a retry loop, or a prompt-injected instruction in a cloned repository, must not be able to drain an hour's budget in one turn. The tool reports its own usage — "3 of 5 for this conversation" — so the model can ration itself instead of discovering the wall.

Agent images count against the 200-entry library cap like any other, because they are in the library like any other.

## Studio

Agent images arrive in the existing history through the existing polling; no new transport. What is added is the ability to tell them apart:

- A badge on entries with `source = "agent"`, naming the project.
- A filter: everything, Studio only, agent only.
- On the detail view, the project and the prompt the agent used, so a user can see what their agent spent money on and why.

The chat transcript shows the generated image inline, because the tool returns it in `ToolResult.images`.

## Security

- The bridge token is random, session-scoped, project-scoped, expiring, and revoked when the session ends — the existing `SupabaseBridge` contract.
- The grant carries `userId`, and every service call is owner-scoped, so one user's agent cannot read, place, or delete another user's images. This is already enforced and tested; the bridge inherits it rather than reimplementing it.
- No image API key ever enters the agent process or the runtime sandbox.
- `output_path` is project-relative, must end `.png`, and is written through `RuntimeDriver`, which is the boundary the architecture requires for project writes. No server-side filesystem write into a project.
- Prompt injection is a live risk: a cloned repository can contain text telling the agent to generate images. The defences are the permission being off by default, the per-session cap, and the shared hourly cap. Worth stating plainly rather than assuming the model will ignore it.
- Bytes crossing the bridge stay under the existing 20 MiB `MAX_IMAGE_BYTES` ceiling.

## Failure behaviour

The states already exist; the tool has to report them honestly rather than flatten them.

| Situation | What the model is told |
| --- | --- |
| Permission off | Tool absent. If reached anyway: how to turn it on, and where |
| No provider configured | An administrator must configure Image Studio; do not retry |
| Hourly or session cap reached | The cap, and that waiting is the only fix. Do not retry in a loop |
| Provider rejected the prompt | The rejection. Do not resubmit the same prompt unchanged |
| Provider timeout / `unknown` | The image may have been billed; it is not resubmitted automatically |
| Storage failure | Saving retries the same result; it never regenerates |
| User cancels the turn | `context.signal` aborts the poll; the job continues server-side and still lands in the library |

Nothing silently falls back to a placeholder or a stock photograph when generation fails. The tool says what happened.

## Files this touches

New:

- `packages/tools/src/images.ts` — the three tools
- `apps/server/src/services/image-bridge.ts` — mint/resolve/revoke, mirroring `supabase-bridge.ts`
- `apps/server/src/routes/image-bridge.ts` — `/api/internal/images/*`
- `packages/db/drizzle/{pg,sqlite}/0016_agent_images.sql` + snapshots + journal

Changed:

- `packages/tools/src/types.ts` — `imageBridge?: { url, token }` on `ToolContext`
- `packages/core/src/protocol.ts` — the same on the session schema
- `packages/core/src/images.ts` — `source`, `projectId`, `projectName`, `sessionId`
- `apps/agent/src/{session,server}.ts` — carry the bridge, hide the tools without it
- `apps/server/src/ws/gateway.ts` — mint the token when the project allows it
- `apps/server/src/app.ts` — register bridge and routes
- `apps/server/src/services/image-generation.ts` — provenance, waiting submit, session cap, configurable hourly limit
- `packages/db/src/{schema/pg,schema/sqlite,repositories/images}.ts`
- `apps/web/src/components/ChatPanel.tsx` — the toggle
- `apps/web/src/pages/ImageStudioPage.tsx` — badge and filter
- `packages/db/test/schema-parity.test.ts`

## Tests

- Bridge: a token resolves to its project and user; expired and unknown tokens are refused; a session's tokens die with it.
- Isolation: user A's agent cannot read, place, or delete user B's image.
- Ownership: an agent-generated row is owned by the connecting user and appears in that user's Studio history with `source = "agent"` and its project.
- Permission: no flag means no token means no tools. Turning it off stops the next session.
- Placement: `place_generated_image` writes real PNG bytes through the runtime; path traversal and a non-`.png` extension are rejected.
- References: `reference_paths` reads project files and forwards them within the count and size limits.
- Limits: the session cap stops a runaway loop; the hourly cap is shared with Studio; a concurrent Studio job makes the agent wait rather than fail.
- Failures: provider rejection, timeout, and storage failure each produce a distinct honest message, and none silently substitutes a placeholder.
- Parity: the new columns exist in both dialects.
- End to end: permission on → agent generates → file appears in the project → image appears in Studio with its badge, against the mock provider, never a billable call.

## Sequence

1. **Bridge and data model.** Migration, provenance columns, `ImageBridge`, internal routes, ownership and isolation tests. Nothing user-visible; everything below rests on it.
2. **The permission.** Column, gateway check, chat toggle, settings entry, disabled state when no provider is configured. Ship before any tool exists, so no capability can ever appear ungated.
3. **`generate_image`.** Including `output_path`, `reference_paths`, previews, and the session cap.
4. **`place_generated_image` and `list_generated_images`.** The reuse path.
5. **Studio provenance.** Badge, filter, project on the detail view.
6. **Prompt guidance.** The generated-versus-photograph rule, in both tool descriptions and the prompt.
7. **Live check.** One real generation through the agent with a real key, confirming cost, latency, and that the image is genuinely usable in a built page.

Steps 1 and 2 are the ones worth being slow about. If the permission is right, everything after it is additive.

## Settled decisions

These were open questions; they are now decided. This is an open-source project, so each one is judged by what happens to a stranger who clones the repository and runs it, not by what suits one instance.

**One toggle, not two.** Generating, listing, and placing sit behind a single per-project switch. A second switch permitting reuse while forbidding spending buys a narrow case and costs a doubled state space in the UI, the gateway, the session, and every explanation of the feature. The library is also the user's private collection across every project, so exposing it to a project agent is a decision worth taking deliberately even when nothing is billed.

**The hourly cap becomes a setting, defaulting to 30 per user.** Ten was sized for a person clicking a button and is too low the moment an agent shares the budget. Thirty covers a page's worth of artwork plus a user experimenting, and still bounds an hour's spend to something an operator can reason about. It is `ZELYQ_IMAGE_HOURLY_LIMIT`, changeable in Settings, because the right number depends on a provider's prices and an operator's budget — neither of which this repository can know.

**Six images per conversation, also a setting.** The session cap exists to stop a retry loop or an injected instruction, not to ration legitimate work; a hero plus a feature row plus a social card is about six. A loop hits six as fast as it hits three, and the hourly cap is the real bound on money. `ZELYQ_IMAGE_SESSION_LIMIT`.

**Any team member may switch the permission on.** They can already spend model tokens and run arbitrary code through the agent. Reserving this for an instance administrator would imply images are the dangerous part, which is not true. The administrator keeps the control that matters at instance level: whether an image API key exists at all.

**Off by default, everywhere.** A cloned instance generates nothing until a person opts in per project. Operators are told plainly, in the setup documentation, that enabling this lets the agent spend money against the instance's image key, and what the two caps do.

## What was built, and what was verified

Everything in the sequence above is implemented: migration `0016_agent_images`, `ImageBridge` and its internal routes, the three tools, the per-project permission with its chat toggle, Studio provenance, and the prompt guidance. The two limits are settings (`ZELYQ_IMAGE_HOURLY_LIMIT`, `ZELYQ_IMAGE_SESSION_LIMIT`) rather than constants.

Verified by test: 244 server tests, 100 tool tests, 440 agent tests, 38 database tests, and the Image Studio browser test — all passing. Among them, an agent generation is owned by the connecting user and shows up in that user's Studio history with its project name; a project without permission is minted no token at all; one user's bridge cannot read another user's image (404, not a leak); a forged or absent token is refused; the per-conversation cap stops a runaway; a placed image is written as base64 bytes rather than text; and an output path must be a relative `.png`.

Verified against the running instance: seventeen migrations applied, all five columns present, **every existing project defaulting to off**, the internal routes registered and answering 401 rather than 404, and a forged bridge token refused on both the read and the generate route.

Two things worth writing down because they were nearly missed. The hourly-limit test hardcoded `10`; raising the default to 30 broke it, and the fix was to read the limit from the API rather than copy the number — the same drift that had already produced a 64 KB body limit against 8 MiB uploads. And `list_generated_images` read the wrong key off the history response (`items` instead of `generations`); the server test caught it, which is the argument for testing the tool against the real route rather than a hand-written stub of it.

Still outstanding: one real generation through the agent with a live provider key, to confirm cost, latency, and that the image is genuinely usable on a built page. Mocked providers establish that the plumbing is correct, not that the pictures are good.
