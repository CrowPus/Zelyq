import assert from "node:assert/strict";
import { after, test } from "node:test";
import { OpenAIImageProvider } from "../src/services/image-providers/openai.js";

const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
});

async function failure(status: number, body: string) {
  globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch;
  try {
    await new OpenAIImageProvider().generate(
      { prompt: "An apple", size: "1024x1024", quality: "low" },
      "gpt-image-2",
      "sk-test",
      AbortSignal.timeout(5000),
    );
  } catch (error) {
    return error as Error;
  }
  assert.fail("generation should have failed");
}

test("an empty OpenAI account is named as such, not as a rate limit", async () => {
  const error = await failure(
    429,
    JSON.stringify({
      error: {
        message: "secret detail that must not be echoed",
        type: "insufficient_quota",
        code: "credit_balance_exhausted",
      },
    }),
  );
  assert.match(error.message, /run out of credit/);
  assert.doesNotMatch(error.message, /secret detail/);
});

test("a real rate limit still says to try again later", async () => {
  const error = await failure(429, JSON.stringify({ error: { code: "rate_limit_exceeded" } }));
  assert.match(error.message, /rate limit/);
});

test("an unreadable 429 body falls back to the rate-limit message", async () => {
  const error = await failure(429, "not json");
  assert.match(error.message, /rate limit/);
});
