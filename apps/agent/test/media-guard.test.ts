import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { LocalRuntimeDriver } from "@zelyq/runtime";
import { MediaGuard, requestCoversFile } from "../src/media-guard.js";
import type { ModelProvider, ProviderEvent, TurnResult } from "../src/providers/types.js";
import { AgentSession } from "../src/session.js";

/**
 * The incident this guards: asked for social buttons in a footer, the agent
 * re-encoded the user's hero video — cropped and upscaled — and moved it over
 * the original. These tests replay it.
 */

const scratch = path.join(os.tmpdir(), `zelyq-media-guard-${Date.now()}`);
after(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

let counter = 0;
async function project() {
  const workspaceDir = path.join(scratch, `w${++counter}`);
  const runtime = new LocalRuntimeDriver({
    kind: "local",
    workspaceDir,
    execTimeoutMs: 15_000,
    previewPortRange: [4940, 4945],
    previewHost: "127.0.0.1",
  });
  const projectId = `prj_guard${counter}`;
  await runtime.ensureProject(projectId);
  const video = Buffer.from(Array.from({ length: 50_000 }, (_, i) => (i * 7) % 256));
  const poster = Buffer.from(Array.from({ length: 9_000 }, (_, i) => (i * 13) % 256));
  await runtime.writeFile(projectId, "public/image-new.mp4", video.toString("base64"), "base64");
  await runtime.writeFile(projectId, "public/media/hero.webp", poster.toString("base64"), "base64");
  await runtime.writeFile(projectId, "src/App.tsx", "export default function App() {}\n");
  const snapshot = await runtime.createSnapshot(projectId, "Before the turn");
  const root = path.join(workspaceDir, projectId);
  return { runtime, projectId, snapshotId: snapshot.id, root, video, poster };
}

test("the footer request does not cover the video; a request about the video does", () => {
  const footer = "i want you to social medial button in the footer";
  assert.equal(requestCoversFile(footer, "public/image-new.mp4"), false);
  assert.equal(requestCoversFile(footer, "public/media/hero.webp"), false);
  assert.equal(
    requestCoversFile("add social media icons to the footer", "public/logo.png"),
    false,
    "'social media' is about a footer, not a file",
  );
  assert.equal(requestCoversFile("make the hero video full width", "public/image-new.mp4"), true);
  assert.equal(requestCoversFile("the video has black bars, crop it", "public/a.mp4"), true);
  assert.equal(requestCoversFile("compress the images", "public/media/hero.webp"), true);
  assert.equal(requestCoversFile("update image-new.mp4", "public/image-new.mp4"), true);
  assert.equal(
    requestCoversFile("make the hero video full width", "public/team-photo.jpg"),
    false,
    "freeing the video does not free every picture",
  );
});

test("a video overwritten in place and a poster moved over are both put back exactly", async () => {
  const { runtime, projectId, snapshotId, root, video, poster } = await project();
  const guard = await MediaGuard.start(
    runtime,
    projectId,
    snapshotId,
    "i want you to social medial button in the footer",
  );
  assert.ok(guard);
  // What the agent did: ffmpeg -y writing over the poster, then a re-encode
  // moved over the original video.
  await fs.writeFile(path.join(root, "public/media/hero.webp"), "a frame grab");
  await fs.writeFile(path.join(scratch, "cropped.mp4"), "re-encoded and upscaled");
  await fs.rename(path.join(scratch, "cropped.mp4"), path.join(root, "public/image-new.mp4"));

  const result = await guard.check();
  assert.deepEqual(result.restored.sort(), ["public/image-new.mp4", "public/media/hero.webp"]);
  assert.deepEqual(result.lost, []);
  assert.ok((await fs.readFile(path.join(root, "public/image-new.mp4"))).equals(video));
  assert.ok((await fs.readFile(path.join(root, "public/media/hero.webp"))).equals(poster));
  assert.deepEqual(
    await guard.check(),
    { restored: [], lost: [] },
    "restored once, not every check",
  );
});

test("a deleted original comes back too, and a request about video leaves the video alone", async () => {
  const { runtime, projectId, snapshotId, root, video } = await project();
  const guard = (await MediaGuard.start(runtime, projectId, snapshotId, "tidy the footer"))!;
  await fs.rm(path.join(root, "public/image-new.mp4"));
  assert.deepEqual((await guard.check()).restored, ["public/image-new.mp4"]);
  assert.ok((await fs.readFile(path.join(root, "public/image-new.mp4"))).equals(video));

  const asked = await MediaGuard.start(
    runtime,
    projectId,
    snapshotId,
    "make the hero video fill the screen",
  );
  await fs.writeFile(path.join(root, "public/image-new.mp4"), "cropped on purpose");
  const result = (await asked?.check()) ?? { restored: [], lost: [] };
  assert.ok(!result.restored.includes("public/image-new.mp4"), "the user asked for this change");
  assert.equal(
    await fs.readFile(path.join(root, "public/image-new.mp4"), "utf8"),
    "cropped on purpose",
  );
});

test("in a real turn, a shell command that overwrites the video is undone and the model is stopped", async () => {
  const { runtime, projectId, snapshotId, root, video } = await project();
  const told: string[] = [];
  let step = 0;
  const say = (text: string): { events: ProviderEvent[]; result: TurnResult } => ({
    events: [{ type: "text", text }],
    result: { toolCalls: [], stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } },
  });
  const steps: Array<{ events: ProviderEvent[]; result: TurnResult }> = [
    {
      events: [],
      result: {
        toolCalls: [
          {
            id: "c1",
            name: "run_command",
            input: { command: "printf 'cropped and upscaled' > public/image-new.mp4" },
          },
        ],
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    },
    say("Added the social buttons. Your hero video has black bars — want me to crop it?"),
  ];
  const provider: ModelProvider = {
    id: "anthropic",
    model: "scripted",
    createConversation() {
      return {
        addUserMessage: (text: string) => {
          told.push(text);
        },
        addToolResults: () => undefined,
        async *stream() {
          const next = steps[Math.min(step++, steps.length - 1)]!;
          for (const event of next.events) yield event;
          return next.result;
        },
      };
    },
  } as unknown as ModelProvider;

  const session = new AgentSession({
    sessionId: "ses_guard",
    projectId,
    projectName: "Guard",
    template: "vite-react",
    provider: "anthropic",
    model: "scripted",
    effort: "high",
    apiKey: "test",
    runtime,
    maxIterations: 5,
    providerFactory: () => provider,
  });
  const request = "i want you to social medial button in the footer";
  await session.beginRequestGuards(snapshotId, request);
  await session.run(request, () => undefined);

  assert.ok(
    (await fs.readFile(path.join(root, "public/image-new.mp4"))).equals(video),
    "the user's video is exactly what it was",
  );
  assert.ok(
    told.some((text) => /STOP — you changed the user's own media/.test(text)),
    `the model must be told; it was told: ${JSON.stringify(told.slice(-3))}`,
  );
});
