import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AgentEvent } from "@zelyq/core";
import { LocalRuntimeDriver, type RuntimeDriver } from "@zelyq/runtime";
import type { ModelProvider, ProviderEvent, TurnResult } from "../src/providers/index.js";
import { AgentSession } from "../src/session.js";

/**
 * The end-of-turn check loads the page. A dev server that is up serves a page
 * that throws on load as readily as one that works, so "the preview is
 * running" passed apps a person would see broken.
 */

const PAGES: Record<string, string> = {
  "/crash": `<!doctype html><html><body><div id="root"></div>
    <script>throw new Error("Cannot read properties of undefined (reading 'map')")</script></body></html>`,
  "/ok": `<!doctype html><html><body><main><h1>Shop</h1></main></body></html>`,
};
let server: http.Server;
let origin = "";

before(async () => {
  server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" }).end(PAGES[request.url ?? ""] ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

type Step = { events: ProviderEvent[]; result: TurnResult };
const usage = { inputTokens: 1, outputTokens: 1 };

async function endOfTurnCheck(page: "/crash" | "/ok") {
  const workspaceDir = path.join(os.tmpdir(), `zelyq-pageload-${Date.now()}-${Math.random()}`);
  const local = new LocalRuntimeDriver({
    kind: "local",
    workspaceDir,
    execTimeoutMs: 20_000,
    previewPortRange: [4985, 4989],
    previewHost: "127.0.0.1",
  });
  await local.ensureProject("prj_load");
  // The real driver, with a preview that is "running" at our page.
  const runtime = Object.create(local) as RuntimeDriver;
  runtime.previewStatus = async () => ({ status: "running", url: `${origin}${page}` }) as never;

  const script: Step[] = [
    {
      events: [],
      result: {
        toolCalls: [
          { id: "w1", name: "write_file", input: { path: "src/note.ts", content: "export {};\n" } },
        ],
        stopReason: "tool_use",
        usage,
      },
    },
    {
      events: [{ type: "text", text: "Done." }],
      result: { toolCalls: [], stopReason: "end_turn", usage },
    },
  ];
  let i = 0;
  const provider = {
    id: "anthropic",
    model: "scripted",
    createConversation: () => ({
      addUserMessage: () => undefined,
      addToolResults: () => undefined,
      async *stream() {
        const step = script[Math.min(i++, script.length - 1)] as Step;
        for (const event of step.events) yield event;
        return step.result;
      },
    }),
  } as unknown as ModelProvider;

  const session = new AgentSession({
    sessionId: "ses_load",
    projectId: "prj_load",
    projectName: "Load",
    template: "vite-react",
    provider: "anthropic",
    model: "scripted",
    effort: "high",
    apiKey: "test",
    runtime,
    maxIterations: 12,
    providerFactory: () => provider,
  });
  const events: AgentEvent[] = [];
  try {
    await session.run("add a note", (event) => events.push(event));
  } finally {
    await local.dispose();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
  const verify = events
    .filter((e) => e.type === "tool.end" && e.call.name === "verify")
    .map((e) => (e as { call: { result?: string; isError?: boolean } }).call);
  return { verify, events };
}

test("an app that throws on load fails the end-of-turn check", async () => {
  const { verify, events } = await endOfTurnCheck("/crash");
  assert.ok(verify.length >= 1, "the check ran");
  assert.equal(verify[0]?.isError, true);
  assert.match(verify[0]?.result ?? "", /throws when it loads[\s\S]*reading 'map'/);
  assert.ok(events.some((e) => e.type === "error" && e.code === "ended_broken"));
});

test("an app that loads cleanly passes it", async () => {
  const { verify } = await endOfTurnCheck("/ok");
  assert.equal(verify[0]?.isError, false);
  assert.match(verify[0]?.result ?? "", /The page loads without errors/);
});
