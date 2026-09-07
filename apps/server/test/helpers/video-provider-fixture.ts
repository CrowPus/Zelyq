import fs from "node:fs/promises";
export const videoFixture = () => fs.readFile(new URL("./video-fixture.mp4", import.meta.url));

/** Original 2-second H.264/AAC test pattern; no external media or live credentials. */
export function videoProviderFixture() {
  let calls = 0;
  let polls = 0;
  let downloads = 0;
  const requests: Record<string, unknown>[] = [];
  const state = {
    mode: "ok" as "ok" | "pending" | "reject" | "ambiguous" | "bad-media" | "download-fails",
  };
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const isGoogle = url.startsWith("https://generativelanguage.googleapis.com/v1beta/");
    const isXai = url.startsWith("https://api.x.ai/v1/videos");
    if (init?.method === "POST" && (isGoogle || isXai)) {
      calls++;
      const body = JSON.parse(String(init.body));
      requests.push(body);
      const headers = new Headers(init.headers);
      if (isGoogle && !headers.get("x-goog-api-key")?.includes("test"))
        throw new Error("Wrong Google test key");
      if (isXai && !headers.get("authorization")?.includes("test"))
        throw new Error("Wrong xAI test key");
      if (state.mode === "reject") return Response.json({ error: "Rejected" }, { status: 400 });
      if (state.mode === "ambiguous") throw new Error("Lost submission response");
      return Response.json(
        isGoogle
          ? { name: `models/veo-3.1-generate-preview/operations/test-${calls}` }
          : { request_id: `test-${calls}` },
      );
    }
    if (isGoogle || isXai) {
      polls++;
      if (state.mode === "pending")
        return Response.json(isGoogle ? { done: false } : { status: "pending" });
      return Response.json(
        isGoogle
          ? {
              done: true,
              response: {
                generateVideoResponse: {
                  generatedSamples: [
                    { video: { uri: "https://storage.googleapis.com/video-test/result.mp4" } },
                  ],
                },
              },
            }
          : {
              status: "done",
              video: { url: "https://vidgen.x.ai/video-test/result.mp4", respect_moderation: true },
            },
      );
    }
    if (
      [
        "https://storage.googleapis.com/video-test/result.mp4",
        "https://vidgen.x.ai/video-test/result.mp4",
      ].includes(url)
    ) {
      downloads++;
      if (state.mode === "download-fails") return new Response("temporary", { status: 503 });
      const bytes = state.mode === "bad-media" ? Buffer.from("not a video") : await videoFixture();
      return new Response(bytes, {
        headers: { "content-type": "video/mp4", "content-length": String(bytes.length) },
      });
    }
    throw new Error("Unexpected external request in video fixture");
  };
  return {
    fetch: fetcher as typeof fetch,
    state,
    requests,
    counts: () => ({ calls, polls, downloads }),
  };
}
