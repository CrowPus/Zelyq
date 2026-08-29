---
name: google
description: Google Gemini. The newer `@google/genai` SDK (replaces `@google/generative-ai`).
---

# Google Gemini

**Pinned:** 2026-08. The Google SDK surface has changed more than once —
`@google/generative-ai` (old) → `@google/genai` (current), and method names
have moved. **Confirm against the installed `@google/genai` types and
<https://ai.google.dev/gemini-api/docs> before relying on any call below.**

## Package

```
npm i @google/genai
```

## Client (Edge Function — Deno)

```ts
import { GoogleGenAI } from "npm:@google/genai";
const ai = new GoogleGenAI({ apiKey: KEY });
```

## Non-streaming

```ts
const res = await ai.models.generateContent({
  model: "gemini-2.5-pro",
  contents: userText,               // or a structured contents array
  config: { systemInstruction: SYSTEM_PROMPT },
});
const text = res.text;              // convenience accessor
```

Some SDK versions expose a higher-level surface (e.g. an `interactions` / chat
object with `.output_text`). If the installed package has one and the docs
show it, prefer it; otherwise use `models.generateContent` above.

## Streaming

```ts
const stream = await ai.models.generateContentStream({ model, contents: userText });
for await (const chunk of stream) {
  if (chunk.text) send(chunk.text);
}
```

## Multi-turn history

Map your stored messages to `contents: [{ role: "user" | "model", parts: [{ text }] }]`.
Note the assistant role is `"model"`, not `"assistant"`.

## Key & model list

- Env name: `GEMINI_API_KEY` (also accepts `GOOGLE_API_KEY`) · `provider = "google"`.
- Validate the model id:
  `GET https://generativelanguage.googleapis.com/v1beta/models?key=KEY` →
  `models[].name` (strip the `models/` prefix). Only ids whose
  `supportedGenerationMethods` include `generateContent` are usable.

## Docs

- <https://ai.google.dev/gemini-api/docs/text-generation>
- <https://ai.google.dev/gemini-api/docs/migrate> (old SDK → `@google/genai`)
