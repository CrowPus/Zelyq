import assert from "node:assert/strict";
import { test } from "node:test";
import { SpeechService } from "../src/services/speech.js";

test("OpenAI transcription sends bearer auth, configured model, and recorded bytes", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const service = new SpeechService(async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ text: "build a dashboard" }), {
      headers: { "content-type": "application/json" },
    });
  });

  const text = await service.transcribe(
    { provider: "openai", model: "whisper-1", apiKey: "sk-test-secret" },
    { audio: Buffer.from("recorded-audio"), mimeType: "audio/webm" },
  );

  assert.equal(text, "build a dashboard");
  assert.ok(request);
  assert.equal(request.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.ok(request.init);
  assert.equal(
    (request.init.headers as Record<string, string>).Authorization,
    "Bearer sk-test-secret",
  );
  assert.ok(request.init.body instanceof FormData);
  const form = request.init.body;
  assert.equal(form.get("model"), "whisper-1");
  assert.equal(form.get("response_format"), "json");
  const file = form.get("file");
  assert.ok(file instanceof File);
  assert.equal(file.type, "audio/webm");
  assert.equal(await file.text(), "recorded-audio");
});

test("a missing provider key fails before any external request", async () => {
  let calls = 0;
  const service = new SpeechService(async () => {
    calls += 1;
    return new Response();
  });

  await assert.rejects(
    () =>
      service.transcribe(
        { provider: "openai", model: "whisper-1", apiKey: "" },
        { audio: Buffer.from("audio"), mimeType: "audio/webm" },
      ),
    /needs an API key/i,
  );
  assert.equal(calls, 0);
});

test("an OpenAI authentication failure is actionable without echoing provider payloads", async () => {
  const service = new SpeechService(
    async () =>
      new Response(JSON.stringify({ error: { message: "bad key sk-secret-should-not-escape" } }), {
        status: 401,
      }),
  );

  await assert.rejects(
    () =>
      service.transcribe(
        { provider: "openai", model: "whisper-1", apiKey: "sk-secret-should-not-escape" },
        { audio: Buffer.from("audio"), mimeType: "audio/webm" },
      ),
    (error: Error) => {
      assert.match(error.message, /rejected the voice API key/i);
      assert.doesNotMatch(error.message, /sk-secret-should-not-escape/);
      return true;
    },
  );
});

test("an unsupported configured speech provider fails clearly", async () => {
  const service = new SpeechService();
  await assert.rejects(
    () =>
      service.transcribe(
        { provider: "future-provider", model: "speech-model", apiKey: "secret" },
        { audio: Buffer.from("audio"), mimeType: "audio/webm" },
      ),
    /not available/i,
  );
});
