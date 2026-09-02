# Solution — alignment with the Messages API

Addresses findings **C1–C5**.

Zelyq's provider seam is well designed. `apps/agent/src/providers/types.ts` explains exactly why
each vendor keeps its own native history instead of flattening to a lossy neutral format, and that
decision has held up. This file is about capability the Messages API ships today that Zelyq is not
reaching through that seam — plus one genuine bug.

Everything here lives in `apps/agent/src/providers/anthropic.ts` and the run loop in `session.ts`.
None of it changes a mode, a tool, or the system prompt's content.

---

## 1. Handle `stop_reason: "max_tokens"` — this is a bug

**Fixes C1. Highest priority in this file.**

### What happens now

`normaliseStopReason` maps it (`anthropic.ts:257`). Nothing reads it. The run loop branches on two
things:

```ts
if (result.stopReason === "refusal") { ...; break; }
if (result.toolCalls.length === 0) { /* end-of-turn path */ }
```

A response cut off at `max_tokens` has no tool calls. It falls into the second branch and is
reported as a turn that finished normally.

### That this is already hurting is not speculation

The Architect prompt spends a paragraph on it:

> **This step must never stall the package.** report.html is large — if one response cannot produce
> the whole thing, write a shorter version that still covers the sections above, or write it section
> by section across turns.

`session.ts` carries a one-shot `emptyRecoveryDone` nudge for it, and a hand-written user-facing
fallback that says, in the product's own voice:

> The model kept returning an empty response — usually the report render being too large for this
> model.

Three separate workarounds for one unhandled stop reason.

### The change

```ts
if (result.stopReason === "max_tokens") {
  // The model was cut off mid-response, not finished. Ask it to continue
  // from where it stopped rather than ending the turn on a truncated answer.
  this.conversation.addContinuation();   // provider-native; see below
  continue;                              // same iteration budget, next round-trip
}
```

The continuation must be provider-native because the shape differs. On Anthropic the assistant's
partial content is already in `this.messages` (pushed verbatim by `stream()`), so the continuation is
a `user`-role — or better, `system`-role, see §3 — message saying *"your previous response was cut
off at the output limit; continue exactly where you stopped, do not repeat what you already wrote."*

Bound it. Two continuations, then stop and tell the user plainly that the output is too large for one
response. An unbounded continuation loop on a model that will not converge is worse than a truncated
answer.

### Also: raise the ceiling

`MAX_TOKENS = 64_000` (`anthropic.ts:15`). Opus 5, Sonnet 5, and the 4.6+ family support **128,000**
output tokens, and the SDKs require streaming at that size — which Zelyq already uses
(`client.messages.stream`). Raising it does not cost anything on a response that does not need it;
output is billed on what is produced.

Note that Haiku 4.5 does **not** support 128K output. `MAX_TOKENS` should be a per-model lookup, not
a constant — the same shape the model registry already uses for `tier`.

### Then delete the workarounds

Once continuation works, the `emptyRecoveryDone` nudge and the "report render too large" fallback
message become dead code describing a problem that no longer exists. Removing them is part of the
change, not a follow-up.

---

## 2. Report `max_tokens` honestly when it does end a turn

Related to §1. `turn.end` currently emits:

```ts
stopReason: refused ? "refusal" : hitIterationCap ? "max_iterations" : "end_turn",
```

There is no `max_tokens` value in that union. After §1, a turn that exhausted its continuations
should say so — `"max_tokens"` — so the UI can tell the user "the answer was too long to finish"
rather than presenting a truncated response as complete. `synthesizeFallbackSummary` already
distinguishes the iteration-cap case from the ordinary one; this is the same idea for a different
cause.

---

## 3. Send operator instructions as system messages, not user messages

**Fixes C2.**

### What is happening

Nine sites in `session.ts` call `this.conversation.addUserMessage(...)` to correct the model
mid-turn (lines 2480, 2505, 2526, 2552, 2576, 2601, 3042, 3056, 3071). Every one is Zelyq speaking
with platform authority, and every one arrives labelled as the human.

### The change

Claude Opus 5 supports **mid-conversation system messages** — `{ role: "system", content: "..." }`
appended to `messages[]`. No beta header. It is the documented operator channel, and the
documentation specifically calls it the prompt-injection-safe one.

Add to the `Conversation` interface:

```ts
/**
 * An instruction from Zelyq itself, not from the user — a verification
 * failure, a mode nudge, a refused dispatch. Providers that support an
 * operator channel use it; the rest fall back to a user message prefixed
 * so the model can still tell the two apart.
 */
addOperatorMessage(text: string): void;
```

`AnthropicConversation` implements it with `{ role: "system", ... }`. The other three implement it
as today's user message with a clear prefix. No behaviour regresses anywhere.

### The rules the API enforces

Get these right or you will get a 400:

- A mid-conversation system message must **follow a `user` message** (or an `assistant` message that
  ends in server-tool use).
- It must be either the **last entry** in `messages`, or be followed by an `assistant` turn.
- It cannot be `messages[0]`.

Every one of Zelyq's nine sites fires after a completed assistant turn and immediately before a
`continue` back into `stream()`, so all nine satisfy this naturally. Assert it anyway — a future
site added in the wrong place would fail at runtime, not at compile time.

- **Not supported on Sonnet 5.** Gate on the model, fall back to the user message.

### Why this matters more than tidiness

Three reasons, in increasing order of importance:

1. The model can tell a Zelyq correction from a user instruction, which is the authority distinction
   these nudges are entirely built on.
2. It preserves the cached prefix — an operator message appended to `messages` does not touch the
   top-level `system` block, so nothing before it is invalidated
   ([01-context-and-cost.md](./01-context-and-cost.md) §1 depends on this).
3. Once untrusted third-party content enters the conversation
   ([05-untrusted-content.md](./05-untrusted-content.md)), "everything non-assistant is `role: user`"
   stops being a style question. §3 here is a prerequisite for that file's §2.

---

## 4. Give dispatched children a budget they can see

**Fixes C3.**

### The situation

```
SUBAGENT_MAX_TURNS   = 25       SPECIALIST_MAX_TURNS   = 40
SUBAGENT_MAX_TOKENS  = 200_000  SPECIALIST_MAX_TOKENS  = 600_000
SUBAGENT_WALLCLOCK   = 5 min    SPECIALIST_WALLCLOCK   = 18 min
```

Enforced from outside. Invisible to the child. A builder does not slow down at turn 22 and land its
work; it is going full speed when the loop stops it, and the parent then reads a report describing
work that is half done.

The `cappedBrokenStreak` escalation in `session.ts:3155` — *"⚠️ The app is BROKEN, and this is the
Nth turn in a row that has run out of steps without fixing it. It is not converging"* — is good
handling of the symptom. §4 is the cause.

### The change

Task budgets, beta `task-budgets-2026-03-13`, supported on Opus 5 / Sonnet 5 / Opus 4.8 / 4.7:

```ts
client.beta.messages.stream({
  betas: ["task-budgets-2026-03-13"],
  output_config: {
    effort: "high",
    task_budget: { type: "tokens", total: 180_000 },
  },
  // ...
})
```

The server injects a countdown marker the model sees while generating, so it paces itself and
finishes gracefully instead of being cut off. Minimum `total` is 20,000.

Two details that matter here:

- **Leave `remaining` unset** in the normal loop. The server tracks the countdown from what the model
  generates plus the tool results it reads. Passing a client-computed `remaining` *while also
  resending full history* under-reports the budget. Only set it if you compact or rewrite history
  between requests — which [01-context-and-cost.md](./01-context-and-cost.md) §3 will eventually do,
  so revisit this then.
- The budget is **advisory**. Keep the hard caps. They are the backstop; this is the pacing signal.
  Set `task_budget.total` to about 90% of the hard cap so the model lands before the guillotine.

### The Haiku collision

`SUBAGENT_MAX_TOKENS = 200_000` is exactly Haiku 4.5's entire context window — and Haiku 4.5 is the
`cheap` tier the Architect prompt tells the model to prefer for most build-plan tasks. A `cheap`
builder cannot reach its token cap without first hitting a context-length error.

The caps should be derived from the child's actual model, not shared constants. The registry already
knows the tier; it should also know the window. `client.models.retrieve(id)` returns
`max_input_tokens` and `max_tokens` live, which is a better source than a hardcoded table that will
drift.

**Done (the collision fix) — 2026-09-02.** `modelTierFor(provider, model)` reads the registry tier.
In `dispatch`, a `cheap`-tier child's `tokenCap` is `min(rawCap, CHEAP_TIER_TOKEN_CAP=150_000)` —
under Haiku 4.5's 200K window, so it lands its work rather than 400ing on context length first.
Strong / standard / custom (unlisted) models keep the full cap untouched, so no large-window model
regresses. `providers.test.ts` (1). The live `models.retrieve` window lookup and the advisory
`task-budgets` countdown are still open (Anthropic-only).

---

## 5. Tune effort in both directions

**Fixes C4.**

### Raise the main loop

Default is `high` (`apps/server/src/services/settings.ts:270`, `config.ts`). Anthropic's current
guidance is that **`xhigh` is the best setting for most coding and agentic use cases** on Opus 5 and
Sonnet 5, and it is Claude Code's own default.

This is a one-line change with a real quality effect and a real cost effect, which means it is
exactly the kind of change that must be **measured, not assumed**. Run the eval suite at `high` and
at `xhigh` on `claude-opus-5` and compare `done` and tokens. That comparison is not currently
possible — see [06-measurement.md](./06-measurement.md) — which is why 06 is a prerequisite for
this one and not an afterthought.

Do not change the default on a hunch. Change it on the number.

### Lower the children

`dispatchBuildTask` passes `effort: this.options.effort` to every child (`session.ts:1761`). So a
`cheap`-tier builder writing a boilerplate component runs at the parent's effort, which after the
above would be `xhigh`.

Anthropic's guidance is explicit: **`low` for subagents and simple tasks.** Map effort from the
task's own `modelTier`:

| tier | model | effort |
| --- | --- | --- |
| `cheap` | Haiku 4.5 | `low` |
| `standard` | Sonnet 5 | `medium` |
| `strong` | Opus 5 | inherit the parent's |

The specialists (Designer, DevOps, Security/QA, Cinematic) already default to `strong` and should
keep the parent's effort — they are doing judgement work, not mechanical work.

### The interaction to remember

A mid-conversation `effort` change invalidates the messages cache. `ensureSession` already destroys
and recreates a session whose effort changed, which is the correct handling and should stay.

---

## 6. Rescue a refusal instead of ending on it

**Fixes C5.**

`session.ts:2446` emits an error event and breaks. That is a dead turn the user has to work around
by hand.

Server-side fallbacks re-run a policy-declined request on a fallback model inside the same call:

```ts
betas: ["server-side-fallback-2026-07-01"],
fallbacks: "default",     // routes by refusal category — no model list to maintain
```

A decline before any output is not billed; the rescue bills at the fallback model's rates.

Three things to keep:

- **Keep the refusal path.** `stop_reason: "refusal"` on the *final* response means the whole chain
  declined, and Zelyq's existing handling is correct for that — it is honest, it does not fabricate
  a summary underneath, and `turn.end` reports it truthfully.
- **Tell the user.** If a fallback ran, say which model answered. `response.model` and the
  `fallback` content blocks carry it. Silently answering on a different model than the one Settings
  names would be dishonest, and this codebase does not do that elsewhere.
- **Not available** on Batches, Bedrock, Vertex, or Foundry. Anthropic-direct only.

Whether to enable this by default is a product call, not an engineering one. Recommendation: enable
it, and surface it — a user who picked Opus 5 and got a Sonnet answer deserves to know, and a user
who got nothing at all deserves it less.

---

## What this adds up to

| change | fixes | effort | payoff |
| --- | --- | --- | --- |
| `max_tokens` continuation + per-model ceiling | C1, C2 | small | fixes a real bug; deletes three workarounds |
| `addOperatorMessage` → `role: "system"` | C2 | small | correct authority; cache-safe; prerequisite for 05 |
| Task budgets on dispatched children | C3 | medium | builders land their work instead of being cut off |
| Per-model caps from the registry | C3 | small | removes the Haiku/200K collision |
| Effort: `xhigh` main, `low` children | C4 | small | quality up where it counts, cost down where it does not |
| Server-side refusal fallbacks | C5 | small | no more dead turns from a classifier false positive |

---

## What you need to do

Ship **§1** now — it is a bug with three workarounds already written for it, and fixing it lets you
delete all three. Then **§3**, because [05-untrusted-content.md](./05-untrusted-content.md) needs it.
Hold **§5** until the eval suite can measure it.

**Next:** [04-agent-competence.md](./04-agent-competence.md)
