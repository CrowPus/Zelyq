---
name: groq
description: Groq (fast inference for Llama and other open models). OpenAI-compatible API; `groq-sdk` or the `openai` SDK with a base URL.
---

# Groq

**Pinned:** 2026-08. Groq rotates its hosted model ids often — always fetch the
live list. Confirm against <https://console.groq.com/docs>.

## Package — either works

```
npm i groq-sdk        # native SDK
# or reuse the openai SDK against Groq's OpenAI-compatible endpoint
npm i openai
```

## Client (Edge Function — Deno)

```ts
import Groq from "npm:groq-sdk";
const client = new Groq({ apiKey: KEY });

// or, OpenAI-compatible:
import OpenAI from "npm:openai";
const client = new OpenAI({ apiKey: KEY, baseURL: "https://api.groq.com/openai/v1" });
```

## Non-streaming (OpenAI-shaped)

```ts
const res = await client.chat.completions.create({
  model: "llama-3.3-70b-versatile",
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userText },
  ],
});
const text = res.choices[0].message.content;
```

## Streaming

Same as OpenAI chat completions — `stream: true`, iterate
`chunk.choices[0].delta.content`.

## Key & model list

- Env name: `GROQ_API_KEY` · `provider = "groq"`.
- Validate the model id: `GET https://api.groq.com/openai/v1/models` (Bearer
  key) → `data[].id`. Treat any pinned default as a starting point.

## Docs

- <https://console.groq.com/docs/api-reference>
- <https://console.groq.com/docs/models>
