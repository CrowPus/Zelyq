---
name: openrouter
description: OpenRouter — one API in front of many providers. OpenAI-compatible; model ids are `vendor/model`.
---

# OpenRouter

**Pinned:** 2026-08. Confirm against <https://openrouter.ai/docs>.

## Package

```
npm i openai
```

OpenAI-compatible.

## Client (Edge Function — Deno)

```ts
import OpenAI from "npm:openai";
const client = new OpenAI({
  apiKey: KEY,
  baseURL: "https://openrouter.ai/api/v1",
  // optional but recommended attribution headers:
  defaultHeaders: { "HTTP-Referer": SITE_URL, "X-Title": APP_NAME },
});
```

## Non-streaming

```ts
const res = await client.chat.completions.create({
  model: "anthropic/claude-sonnet-4.6",   // NOTE: vendor/model form
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userText },
  ],
});
const text = res.choices[0].message.content;
```

## Streaming

Standard OpenAI chat-completions streaming.

## Key & model list

- Env name: `OPENROUTER_API_KEY` · `provider = "openrouter"`.
- Model ids are always `vendor/model` (e.g. `openai/gpt-5.1`,
  `google/gemini-2.5-pro`, `x-ai/grok-4.6`).
- Validate: `GET https://openrouter.ai/api/v1/models` → `data[].id`.

## Docs

- <https://openrouter.ai/docs/api-reference/overview>
- <https://openrouter.ai/models>
