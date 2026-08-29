---
name: mistral
description: Mistral AI (mistral-large / medium / small). Official `@mistralai/mistralai` SDK.
---

# Mistral AI

**Pinned:** 2026-08. Confirm against the installed `@mistralai/mistralai` types
and <https://docs.mistral.ai>.

## Package

```
npm i @mistralai/mistralai
```

## Client (Edge Function — Deno)

```ts
import { Mistral } from "npm:@mistralai/mistralai";
const client = new Mistral({ apiKey: KEY });
```

## Non-streaming

```ts
const res = await client.chat.complete({
  model: "mistral-large-latest",
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userText },
  ],
});
const text = res.choices[0].message.content;
```

## Streaming

```ts
const stream = await client.chat.stream({ model, messages });
for await (const chunk of stream) {
  const delta = chunk.data.choices[0]?.delta?.content;
  if (delta) send(delta);
}
```

## Key & model list

- Env name: `MISTRAL_API_KEY` · `provider = "mistral"`.
- Validate the model id: `GET https://api.mistral.ai/v1/models` (Bearer key) →
  `data[].id`. The `-latest` aliases (`mistral-large-latest`, …) are stable
  and preferred.

## Docs

- <https://docs.mistral.ai/api/>
- <https://docs.mistral.ai/capabilities/completion/>
