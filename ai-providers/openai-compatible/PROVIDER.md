---
name: openai-compatible
description: Any endpoint speaking the OpenAI chat-completions dialect — a self-hosted model (Ollama, vLLM, LM Studio) or a private gateway.
---

# OpenAI-compatible / custom endpoint

Use this when the user names an endpoint rather than a hosted vendor — their
own model on their own network, or a gateway. The contract is the OpenAI
chat-completions API; only the base URL (and sometimes the key) differ.

**Confirm the endpoint's own docs** — some implement a subset (no streaming, no
`system` role, different stop conditions).

## Package

```
npm i openai
```

## Client (Edge Function — Deno)

```ts
import OpenAI from "npm:openai";
const client = new OpenAI({
  apiKey: KEY ?? "not-needed",          // many self-hosted servers ignore it
  baseURL: BASE_URL,                    // e.g. http://host:11434/v1 (Ollama), http://host:8000/v1 (vLLM)
});
```

## Non-streaming

```ts
const res = await client.chat.completions.create({
  model: MODEL,                         // the exact name the server reports
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userText },
  ],
});
const text = res.choices[0].message.content;
```

## Streaming

`stream: true` if the endpoint supports it; iterate
`chunk.choices[0].delta.content`. Fall back to non-streaming if it does not.

## Key, base URL & model list

- The user supplies BASE_URL and (optionally) a key. Store the key as
  `provider = "openai-compatible"` in `ai_credentials`; keep BASE_URL in the
  Edge Function config or a non-secret table column — it is not a secret.
- Validate the model id: `GET {BASE_URL}/models` → `data[].id`, when the
  endpoint implements it. If it does not, trust the name the user gave and say
  so in `ai.md`.
- A plaintext `http://` base URL is acceptable only for a local address; warn
  otherwise.

## Docs

- Whatever the user's endpoint publishes. Common: Ollama
  <https://github.com/ollama/ollama/blob/main/docs/openai.md>, vLLM
  <https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html>.
