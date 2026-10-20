import assert from "node:assert/strict";
import { test } from "node:test";
import { videoProviders } from "../src/services/video-providers/index.js";

/**
 * When Google filters a video it says why. That reason is what lets someone
 * fix the request, so it must reach the person — not a generic guess.
 */
test("a filtered Google video carries Google's own reason", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        done: true,
        response: {
          generateVideoResponse: {
            raiMediaFilteredCount: 1,
            raiMediaFilteredReasons: [
              "Sorry, we can't create videos with real people's names or likenesses. Please remove the celebrity reference and try again.",
            ],
          },
        },
      }),
      { headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  try {
    const result = await videoProviders.google.lookup(
      "models/veo-test/operations/op1",
      "key",
      AbortSignal.timeout(5000),
    );
    assert.equal(result.status, "failed");
    assert.match(
      result.status === "failed" ? result.error : "",
      /^Google declined this video: Sorry, we can't create videos with real people's names or likenesses/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
