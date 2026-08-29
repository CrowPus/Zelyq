---
name: openai
description: OpenAI (GPT-5 family, o-series). Official `openai` npm SDK; chat-completions and the newer Responses API.
---

# OpenAI

**Pinned:** 2026-08. Confirm every call against the installed `openai` package's
types and <https://platform.openai.com/docs>.

## Package

```
npm i openai
```

## Client (in the Edge Function — Deno)

```ts
import OpenAI from "npm:openai";
const client = new OpenAI({ apiKey: KEY }); // KEY read from ai_credentials
```

## Non-streaming — chat completions (widely compatible)

```ts
const res = await client.chat.completions.create({
  model: "gpt-5.2",
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userText },
  ],
});
const text = res.choices[0].message.content;
```

## Non-streaming — Responses API (newer, simpler I/O)

```ts
const res = await client.responses.create({ model: "gpt-5.2", input: userText });
const text = res.output_text;
```

## Streaming (chat completions)

```ts
const stream = await client.chat.completions.create({ model, messages, stream: true });
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content;
  if (delta) send(delta);
}
```

## Reasoning models

`gpt-5*` and `o*` take `reasoning_effort: "low" | "medium" | "high"`. Some
newer variants reject `reasoning_effort` together with `tools` on
chat-completions — use the Responses API for those.

## Key & model list

- Env name: `OPENAI_API_KEY` · stored as `provider = "openai"` in `ai_credentials`.
- Validate the model id: `GET https://api.openai.com/v1/models` (Bearer key) →
  `data[].id`.

## Docs

- <https://platform.openai.com/docs/api-reference/chat>
- <https://platform.openai.com/docs/api-reference/responses>
