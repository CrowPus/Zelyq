# Gemini model integration

Implemented and verified on 2026-09-10. Unlike the OpenAI and Claude catalogs,
this one was built from a live listing and a live probe rather than from a
written reference, because Gemini's thinking configuration is not uniform and
the differences are not documented in one place.

## The defect this fixes

`apps/agent/src/providers/google.ts` sent the same `thinkingConfig` to every
Gemini model:

```ts
thinkingConfig: { includeThoughts: true, thinkingLevel: toThinkingLevel(effort) }
```

Probed against `:generateContent` with a real key, the 2.5 family rejects that
outright — `400 Thinking level is not supported for this model.` **And
`gemini-2.5-pro` was this provider's configured default**, so the default Gemini
model failed on every turn. `gemini-2.5-flash` was in the picker too.

| Model | `thinkingLevel` | Valid `thinkingBudget` |
| --- | --- | --- |
| `gemini-2.5-pro` | **400** | 128 – 32768 |
| `gemini-2.5-flash` | **400** | any (0 disables) |
| `gemini-2.5-flash-lite` | **400** | 512 – 24576 |
| `gemini-pro-latest`, `gemini-flash-latest`, `gemini-flash-lite-latest` | OK | any |
| `gemini-3-flash-preview`, `3.1-flash-lite`, `3.1-pro-preview` | OK | any |
| `gemini-3.5-flash`, `3.5-flash-lite`, `3.6-flash`, `3.7-flash`, `3.8-flash` | OK | any |

The budget ranges genuinely differ per model, so one shared constant would be
wrong. `googleThinkingConfig()` scales the requested effort into whichever
range the chosen model advertises, and returns a level for everything else. An
unknown or newer custom ID gets the modern level shape rather than a guessed
budget range.

## The catalog

`packages/core/src/google-models.ts`, from a live `/v1beta/models` listing
filtered to `generateContent`. Recommended: **Gemini Pro (latest)** (default),
**3.8 Flash**, **Flash (latest)**, **Flash Lite (latest)**. The 3.x line sits
under *More models*; the 2.5 line is grouped as legacy.

The default moves from `gemini-2.5-pro` to `gemini-pro-latest`. That is not a
preference change — the old default was broken, and `-latest` is Google's own
stable alias for the current Pro.

There is no 3.x "pro" beyond `gemini-3.1-pro-preview`; the pro line is reached
through `gemini-pro-latest`. Image, TTS, transcribe, robotics, computer-use and
omni variants are excluded: this agent needs multi-step tool calling.

Prices are absent on purpose. The models endpoint does not carry them and
nothing here verified them, so the eval report keeps its own hand-checked
Gemini rates rather than inheriting a guess.

## Validation

- Live: the exact config `googleThinkingConfig()` produces returns 200 from
  `:generateContent` on `gemini-2.5-pro`, `gemini-2.5-flash-lite`,
  `gemini-pro-latest` and `gemini-3.8-flash`. The first two returned 400 before.
- Live: discovery against a real key returns `verified` and filters TTS, image
  and embedding entries out of the listing.
- Unit tests pin the per-model budget ranges and the 2.5 exclusion.
- Browser tests cover the picker's grouping and Settings round-trips.
