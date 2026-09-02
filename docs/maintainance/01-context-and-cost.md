# Solution — context and cost

Addresses findings **A1–A5**.

This is the highest-value file in the folder. Everything here is a change inside
`apps/agent/src/providers/anthropic.ts` and one new module; none of it touches the system prompt,
the tools, or any mode boundary. The measured saving is roughly **an order of magnitude on input
tokens for long turns**, and it removes a class of hard failure that is coming.

A note on ordering: §1 (caching) is cheap and safe and should ship first, because §2 and §3 change
what is in the conversation and you want the cache instrumentation from §4 in place to prove each
one worked.

---

## 1. Put a rolling cache breakpoint on the conversation

**Fixes A1.**

### The rule

Caching is a **prefix match**, rendered `tools → system → messages`. A byte change anywhere
invalidates everything after it. Four breakpoints per request.

Zelyq's current single breakpoint on `system` caches `tools + system` — which are genuinely stable
for a session, so that part is already right. The messages array is the part that grows, and it is
the part paid for in full every round-trip.

### The change

Keep the system breakpoint. Add a second breakpoint on the **last** message in the array before each
request, and keep a third on the message that held it last time.

```ts
// AnthropicConversation.stream(), before building the request.
// The messages array is append-only, so "the last block of the last message"
// is always the end of the stable prefix for the NEXT request.
```

Why two moving breakpoints rather than one: the cache is written on request N and read on request
N+1. If you only ever mark the current tail, request N+1's prefix ends *before* your only
breakpoint, and you get a partial hit. Marking both the current tail and the previous tail means
request N+1 reads everything up to the old breakpoint from cache and writes a new one at the new
tail. This is the standard incremental pattern and it is why the API allows four.

Budget for the four:

| # | where | why |
| --- | --- | --- |
| 1 | end of `system` | already there; the stable prompt + tools |
| 2 | previous turn's tail | the read breakpoint — this is the hit |
| 3 | current tail | the write breakpoint — sets up the next request |
| 4 | spare | leave it; reserve for a future static block |

### The constraint to respect

The minimum cacheable prefix is model-dependent (512–4096 tokens). Below it, the marker is silently
ignored — no error, no cache. Zelyq's system prompt is already well over that
(default ~4,573 tokens, Architect ~22,521), so breakpoint 1 always caches. Breakpoints 2 and 3
should only be set once the conversation itself is past a few thousand tokens; below that, marking
them costs a 1.25× cache write for no read.

### The invalidators to audit before shipping

Anything that makes the prefix differ between two requests destroys the hit. Audit these:

- **The system prompt must be byte-stable for the session.** It currently is — `buildSystemPrompt`
  is called once in the constructor and the result stored. Keep it that way. Do not inject a
  timestamp, a turn counter, or a remaining-budget figure into it. (This matters for
  [04-agent-competence.md](./04-agent-competence.md) §3 — surface budget in a *message*, never in
  the system prompt.)
- **The tool list must be byte-stable and deterministically ordered.** It currently is, with one
  exception: `grantSpecialistTools` (`session.ts:2127`) pushes new tools onto `liveTools`
  mid-session when the user picks from `/agent`. That is an add-only mutation and it is correct
  behaviour — but it **invalidates the entire cache** on that turn, because `tools` renders before
  `system`. Nothing to fix; just know it, and do not be surprised by a cache miss on a turn that
  used `/agent`.
- **`effort` changes invalidate the messages cache.** The gateway forwards the live `effort` setting
  on every prompt (`gateway.ts`), and `ensureSession` destroys and recreates the session when it
  differs. That is already the right handling.

### Expected result

For the ~291K-token session measured in A1: request 1 of a turn writes the cache; requests 2–50 read
~99% of history at 0.1×. Input cost for a full-budget turn drops from roughly **$73 to roughly $8**,
and time-to-first-token improves on every iteration after the first.

### How to verify

§4 below. Do not ship this without §4 — a silently-broken cache looks exactly like a working one.

---

## 2. Clear stale tool inputs and results from history

**Fixes A2.**

### What the numbers say

`write_file` inputs are ~999,000 tokens of the measured history; `write_file` + `edit_file` inputs
together are 4,708,086 characters — **~1.27M tokens, 68.5% of every tool-call byte in the
database**. All of it duplicates content that is on disk and readable with `read_file`.

### The change

Enable Anthropic's context editing on the beta messages endpoint:

```ts
client.beta.messages.stream({
  betas: ["context-management-2025-06-27"],
  context_management: {
    edits: [{ type: "clear_tool_uses_20250919", clear_tool_inputs: true }],
  },
  // ...
})
```

`clear_tool_uses_20250919` clears **old tool results**; `clear_tool_inputs: true` also clears the
`tool_use` parameter blocks — which is the half that matters most here, because that is where
`write_file`'s 8,069-character average lives.

This is **clearing**, not summarising. Nothing is sent to a model to be compressed; blocks are
dropped before the request is built. It is cheap and lossless in the sense that matters: the
filesystem still has the file.

### The interaction with caching

Clearing history changes the prefix, so it invalidates the cache at the point it clears. That is
fine and expected — you take one cache miss when a clear fires, and then rebuild a much smaller
prefix. It is why §1 ships first: you want the caching working so you can see the clear's effect as
a step change rather than noise.

### The one thing to be careful about

`write_file`'s tool input must survive on the request *immediately* following the call — the model
needs to see its own tool_use block paired with its tool_result. Context editing handles the
recency window itself; do not hand-roll this.

### The Zelyq-side companion change

Independently of the API feature, there is a cheap local win. `session.ts:2971` already truncates
the **persisted** tool result to 4,000 characters:

```ts
result: outcome.output.slice(0, 4000),
```

but the *input* is persisted whole. `packages/db/src/repositories/messages.ts` stores
`JSON.stringify(message.toolCalls)` with no cap on `input`. Capping a persisted `write_file` /
`edit_file` input to a short marker — `"[content omitted — the file is on disk]"` — with the full
content dropped, would shrink every rebuilt-from-history session immediately, on every provider,
with no beta header. That is worth doing regardless of §2, because it also fixes the
history-reconstruction path that runs after a server restart.

**Caveat, stated plainly:** dropping the input from the persisted record means the transcript UI can
no longer show what the agent wrote in that call. Decide whether the UI needs it. If it does, store
it in a separate column the agent never reads back, rather than in the block that gets replayed.

**Shipped — 2026-09-01.** `stripHeavyToolInputs(calls)` in `packages/core/src/models.ts`: for
`write_file` (`content`) and `edit_file` (`old_text` / `new_text`), any value over 200 chars becomes
`OMITTED_TOOL_INPUT_MARKER`; shorter values and every other tool are untouched; it is a pure copy.
`ChatGateway` calls it on `assistant.toolCalls` immediately before `store.messages.append`, in the
`finally` — the `turn.end` broadcast just above still carries the full copy for the live client. The
transcript's `ToolRow` only reads `input.path` and `result`, so nothing on screen changes. The
history-rebuild path (`buildAnthropicHistory` and its OpenAI/Google equivalents) pairs the shortened
`tool_use` input with its existing `tool_result` summary unchanged; a model that needs the current
bytes calls `read_file`. Verified: `@zelyq/core` 6 new tests, `@zelyq/server` 215/215.

---

## 3. Add compaction as the backstop

**Fixes A3.**

§2 delays the wall. It does not remove it: a long enough session will still exceed the window, and
on Haiku 4.5's 200K it will happen quickly.

### The change

Server-side compaction, beta `compact-2026-01-12`:

```ts
context_management: { edits: [{ type: "compact_20260112" }] }
```

The API summarises earlier context when it approaches the trigger threshold (default 150K tokens).

### The one rule that will bite you

**Append `response.content` back to `messages`, not just the text.** The response carries a
compaction block that the API needs on the next request to know what it replaced. Extracting only
the text and appending that silently loses the compaction state.

Zelyq's `AnthropicConversation` already does the right thing here — `stream()` pushes
`{ role: "assistant", content: response.content }` verbatim, with the comment *"Echoed back
unchanged — thinking blocks included."* The pattern is in place; compaction just needs turning on.

**Wired, off by default — 2026-09-02.** `ZELYQ_COMPACTION=1` adds the
`context-management-2025-06-27` beta header and `context_management: { edits: [{ type:
"compact_20260112" }] }` to the request (cast — the non-beta SDK types do not carry it). Both the
header and the body param are absent when the flag is off, so a normal request is unchanged. The
`response.content` echo-back already keeps the compaction block. `anthropic-beta-flags.test.ts` pins
the exact strings (a wrong one is a 400 with no typecheck to catch it). Not verified against a live
turn yet — that is the one test to run before setting the flag in `.env`.

### Cross-provider parity

`compact_20260112` and `clear_tool_uses_20250919` are Anthropic features. Zelyq supports Google,
OpenAI-dialect, and self-hosted endpoints, and `docs/agent-behaviour.md` states a policy —
*"prefer fixing the prompt or a tool description over branching on the provider"* — which this
would violate if it were prompt-level. It is not: this is transport-level, inside the provider
seam, which is exactly what that seam is for (`providers/types.ts` explains the design). Each
provider does what it can:

| provider | what it can do |
| --- | --- |
| Anthropic | context editing + compaction, native |
| Google | Gemini has explicit context caching; no clear/compact equivalent |
| OpenAI-dialect | automatic prefix caching server-side; no clear/compact |

For the non-Anthropic providers, the local `Conversation` implementation should do a simple,
honest version of the same thing: when the estimated history exceeds a configured fraction of the
model's window, drop the oldest tool-call inputs and results (never the prose), and insert one
plain line saying so. That is worse than compaction and much better than a 400.

### The user-facing part

When the window is genuinely exhausted and nothing else helps, the failure must be a *product*
state, not a raw provider error. Something like: *"This conversation has grown too large for
`<model>`. Start a new session on this project — the code and the plan are on disk and the new
session will read them."* That message is honest and actionable; the current one is neither.

**Done (the honest message) — 2026-09-02.** `isContextLengthError(error)` in `providers/index.ts`
matches the window-overflow wording from every vendor (there is no clean code). `session.ts`'s
top-level catch emits `code: "context_exhausted"` with exactly that message instead of the raw 400.
The web already renders `message.message` as the error state, so it reads as a product state without
a UI branch. `providers.test.ts` (2). The Anthropic-native `compact_20260112` and the per-provider
"drop oldest tool inputs" degrade are still open — this is the floor, not the ceiling.

---

## 4. Capture cache usage, and correct the token counter

**Fixes A4. Do this alongside §1 — it is how you prove §1 works.**

### The change

Widen `TurnResult.usage` in `apps/agent/src/providers/types.ts`:

```ts
usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;      // ~0.1× cost
  cacheCreationInputTokens?: number;  // ~1.25× cost
};
```

Map them in `anthropic.ts`. Leave them `undefined` on providers that do not report them — an
optional field is honest; a zero is a claim.

### The correction that follows

`session.ts` accumulates `this.tokensIn += result.usage.inputTokens` and emits it as `usage`. Since
`input_tokens` excludes cached tokens, the figure users see today is the uncached remainder, not the
request size. Once §1 lands, that number will *drop by ~90%* while the true request size is
unchanged — which would read as a large win and would be measuring the wrong thing.

Report both: the total prompt size (`input + cache_read + cache_creation`) and the cached fraction.
A "94% cached" line in the UI is a genuinely good signal for a user watching a long build, and it is
the number a maintainer needs.

### Update the doc

`docs/agent-behaviour.md:259` currently instructs a maintainer to check
`usage.cache_read_input_tokens`. Once this ships, that instruction becomes true. Until then it
should say where the number actually is, or the doc is lying about its own codebase.

---

## 5. Fix the history window

**Fixes A5.**

`packages/db/src/repositories/messages.ts:107` takes the oldest 500 messages. It should take the
newest N and return them in ascending order:

```ts
async listForSession(sessionId, limit = 500) {
  const rows = await db.select().from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt))   // newest first
    .limit(limit);
  return rows.reverse().map(toMessage);  // back to chronological
}
```

Two things to get right:

- **The reversal must produce a valid conversation.** A window that begins mid-tool-use — an
  assistant `tool_use` whose `tool_result` was cut off, or vice versa — is a 400 from every
  provider. Trim the window forward to the first `user` message that is not a tool-result carrier.
  `buildAnthropicHistory` already reconstructs the pairs correctly *given* a clean window; it cannot
  fix a window that starts in the wrong place.
- **500 messages is the wrong unit.** After §2 and §4 you will know the token cost of a message.
  Bound the window by *tokens*, not by count — that is the quantity that actually matters, and it is
  the same budget the compaction threshold uses.

This is latent today (largest real session: 73 messages). Fix it while it is cheap.

**Done — 2026-09-02.** `listForSession` now orders `desc(createdAt)`, `limit` the newest rows, then
`historyWindow(rows, maxTokens)` (exported, pure): walk from newest spending an approximate token
budget (`estimateRowTokens` = chars/4 over content + thinking + tool-call JSON), stop when
`maxTokens` (default 180K) is exceeded with at least one kept, reverse to chronological, then shed
leading non-`user` rows so the window can't open on an assistant turn. Defaults `limit 400 /
maxTokens 180_000`; both gateway callers use them unchanged. `history-window.test.ts` (5).

---

## What this adds up to

| change | fixes | effort | payoff |
| --- | --- | --- | --- |
| Rolling message cache breakpoints | A1 | small | ~10× on input cost for long turns; faster iterations |
| Context editing (`clear_tool_uses`) | A2 | small | ~1.27M tokens of dead weight removed from the measured corpus |
| Cap persisted `write_file`/`edit_file` inputs | A2 | small | same, on every provider, no beta header |
| Compaction + honest exhaustion message | A3 | medium | removes a hard failure that is coming for `cheap`-tier builders |
| Cache usage in `TurnResult` | A4 | small | makes the other four verifiable |
| Newest-N history window, token-bounded | A5 | small | closes a latent silent-amnesia bug |

---

## What you need to do

Ship §1 and §4 together — they are small, they are safe, and §4 is the proof. Then §2, then §5, then
§3. Measure with the eval suite ([06-measurement.md](./06-measurement.md)) after each, once it
reports tokens.

**Next:** [02-tool-surface.md](./02-tool-surface.md)
