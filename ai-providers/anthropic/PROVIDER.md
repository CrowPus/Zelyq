---
name: anthropic
description: Anthropic Claude (Opus, Sonnet, Haiku). Official `@anthropic-ai/sdk`; the Messages API.
---

# Anthropic (Claude)

**Pinned:** 2026-08. Confirm against the installed `@anthropic-ai/sdk` types and
<https://docs.claude.com/en/api>. Zelyq ships a `claude-api` skill with the
authoritative model ids — load it if available.

## Package

```
npm i @anthropic-ai/sdk
```

## Client (Edge Function — Deno)

```ts
import Anthropic from "npm:@anthropic-ai/sdk";
const client = new Anthropic({ apiKey: KEY });
```

## Non-streaming — Messages API

```ts
const res = await client.messages.create({
  model: "claude-sonnet-5",
  max_tokens: 1024,                 // REQUIRED
  system: SYSTEM_PROMPT,            // top-level, not a message
  messages: [{ role: "user", content: userText }],
});
const text = res.content[0].type === "text" ? res.content[0].text : "";
```

`messages` alternate user / assistant. `system` is a top-level string, not a
role.

## Streaming

```ts
const stream = client.messages.stream({ model, max_tokens: 1024, system, messages });
for await (const event of stream) {
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    send(event.delta.text);
  }
}
```

## Model ids (2026-06, no date suffixes)

`claude-opus-5`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`,
`claude-fable-5`. There is no public model-list endpoint — validate against
this list / the docs, or a cheap `messages.create` with `max_tokens: 1`.

## Key & docs

- Env name: `ANTHROPIC_API_KEY` · `provider = "anthropic"`.
- <https://docs.claude.com/en/api/messages>
- <https://docs.claude.com/en/docs/build-with-claude/streaming>
