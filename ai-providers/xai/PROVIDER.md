---
name: xai
description: xAI Grok. OpenAI-compatible API — use the `openai` SDK with xAI's base URL.
---

# xAI (Grok)

**Pinned:** 2026-08. Confirm against <https://docs.x.ai>.

## Package

```
npm i openai
```

xAI is OpenAI-compatible; there is no separate SDK to learn.

## Client (Edge Function — Deno)

```ts
import OpenAI from "npm:openai";
const client = new OpenAI({ apiKey: KEY, baseURL: "https://api.x.ai/v1" });
```

## Non-streaming

```ts
const res = await client.chat.completions.create({
  model: "grok-4.6",
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userText },
  ],
});
const text = res.choices[0].message.content;
```

## Streaming

Standard OpenAI chat-completions streaming — `stream: true`, iterate
`chunk.choices[0].delta.content`.

## Key & model list

- Env name: `XAI_API_KEY` · `provider = "xai"`.
- Validate the model id: `GET https://api.x.ai/v1/models` (Bearer key) →
  `data[].id`. Older `grok-4` / `grok-4-fast` ids have been retired — use the
  current `grok-4.x` line.

## Docs

- <https://docs.x.ai/docs/api-reference>
- <https://docs.x.ai/docs/models>
