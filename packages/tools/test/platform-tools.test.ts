import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pipelineRunTool,
  runPipelineTool,
  savePipelineTool,
  zelyqPlatformTool,
} from "../src/platform.js";
import type { ToolContext } from "../src/types.js";

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    projectId: "prj_x",
    runtime: {
      readFile: async (_id: string, path: string) => {
        if (path !== ".zelyq/pipelines/shop.yml") throw new Error("missing");
        return { path, content: "name: Shop CI\n" };
      },
    } as unknown as ToolContext["runtime"],
    signal: new AbortController().signal,
    onFileChanged: () => undefined,
    log: () => undefined,
    ...over,
  };
}
const bridged = (over: Partial<ToolContext> = {}) =>
  ctx({ previewBridge: { url: "http://server", token: "grant" }, ...over });

async function withFetch<T>(
  respond: (url: string, init: { method: string; token?: string; body?: unknown }) => Response,
  run: () => Promise<T>,
): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) =>
    respond(String(url), {
      method: init?.method ?? "GET",
      token: new Headers(init?.headers).get("x-zelyq-preview-bridge") ?? undefined,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })) as never;
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

const overview = {
  app: { name: "Shop", id: "prj_x" },
  role: "editor",
  localRunner: { available: true, busy: 0, places: 2 },
  runners: [{ name: "box", os: "linux", labels: ["docker"], online: null }],
  environments: [
    {
      name: "staging",
      protected: false,
      frozen: false,
      frozenReason: null,
      machine: "box",
      domain: "staging.example.com",
      address: "203.0.113.7",
      variables: ["STRIPE_KEY"],
      thisApp: { url: "https://shop.staging.example.com", number: 4, status: "live", at: "x" },
      otherApps: 1,
    },
    {
      name: "production",
      protected: true,
      frozen: true,
      frozenReason: "release freeze",
      machine: "box",
      domain: null,
      address: "203.0.113.7",
      variables: [],
      thisApp: null,
      otherApps: 0,
    },
  ],
  pipelines: [
    {
      name: "Shop CI",
      base: "abc123",
      source: "name: Shop CI\nruns-on: local\n",
      runsOn: "local",
      deploysTo: ["staging"],
      keptInRepository: null,
      triggers: [{ kind: "app", enabled: true }],
      lastRun: { number: 7, status: "failed", at: "x" },
    },
  ],
};

test("every platform tool refuses without the session's grant", async () => {
  for (const [tool, input] of [
    [zelyqPlatformTool, {}],
    [savePipelineTool, { path: ".zelyq/pipelines/shop.yml" }],
    [runPipelineTool, { pipeline: "Shop CI" }],
    [pipelineRunTool, { pipeline: "Shop CI" }],
  ] as const) {
    const result = await tool.run(ctx(), input as never);
    assert.equal(result.isError, true, tool.name);
  }
});

test("zelyq_platform says what is live, what is protected or frozen, and how to write a file", async () => {
  const result = await withFetch(
    (url, init) => {
      assert.equal(url, "http://server/api/internal/platform/overview");
      assert.equal(init.token, "grant");
      return Response.json(overview);
    },
    () => zelyqPlatformTool.run(bridged(), {}),
  );
  assert.equal(result.isError, undefined);
  assert.match(result.output, /this app is live: deploy #4 \(live\) https:\/\/shop\.staging/);
  assert.match(result.output, /production .*protected: every deploy waits for an admin/);
  assert.match(result.output, /FROZEN \(release freeze\)/);
  assert.match(
    result.output,
    /Shop CI — runs on local, deploys to staging; last run #7 failed; starts by itself on: app/,
  );
  assert.match(result.output, /base: abc123/);
  assert.match(result.output, /How a pipeline file is written/);
});

test("with no environment, it says what an admin adds instead of inventing a host", async () => {
  const result = await withFetch(
    () => Response.json({ ...overview, environments: [], pipelines: [] }),
    () => zelyqPlatformTool.run(bridged(), {}),
  );
  assert.match(result.output, /Ship → Deployments → New environment/);
  assert.match(result.output, /- none yet\./);
});

test("save_pipeline sends the project's file and reports problems by line", async () => {
  const sent: unknown[] = [];
  const result = await withFetch(
    (url, init) => {
      sent.push(init.body);
      assert.equal(url, "http://server/api/internal/platform/pipelines/save");
      return Response.json({
        ok: false,
        issues: [{ line: 3, message: "stages must be a list" }],
        warnings: [],
        saved: null,
      });
    },
    () => savePipelineTool.run(bridged(), { path: ".zelyq/pipelines/shop.yml", check_only: true }),
  );
  assert.deepEqual(sent, [{ source: "name: Shop CI\n", save: false }]);
  assert.equal(result.isError, true);
  assert.match(result.output, /line 3: stages must be a list/);

  const missing = await savePipelineTool.run(bridged(), { path: "nope.yml" });
  assert.equal(missing.isError, true);
});

test("save_pipeline passes base and says it has not run yet", async () => {
  const result = await withFetch(
    (_url, init) => {
      assert.deepEqual(init.body, { source: "name: Shop CI\n", save: true, base: "abc123" });
      return Response.json({
        ok: true,
        issues: [],
        warnings: ["STRIPE_KEY is not in Vault yet."],
        saved: { name: "Shop CI", created: false, base: "def456", deploysTo: ["staging"] },
      });
    },
    () => savePipelineTool.run(bridged(), { path: ".zelyq/pipelines/shop.yml", base: "abc123" }),
  );
  assert.equal(result.isError, undefined);
  assert.match(
    result.output,
    /Saved a new version of Shop CI .*base now def456.*deploys to staging/,
  );
  assert.match(result.output, /It has not run/);
  assert.match(result.output, /STRIPE_KEY is not in Vault yet/);
});

test("a server refusal reaches the model as the server's own words", async () => {
  const result = await withFetch(
    () =>
      Response.json(
        { error: { message: "This action needs the editor role or higher. Yours is viewer." } },
        { status: 403 },
      ),
    () => runPipelineTool.run(bridged(), { pipeline: "Shop CI" }),
  );
  assert.equal(result.isError, true);
  assert.match(result.output, /Yours is viewer/);
});

const run = (over: Record<string, unknown>) => ({
  pipeline: "Shop CI",
  number: 8,
  runId: "run_8",
  status: "running",
  error: null,
  stages: [{ name: "Test", status: "running" }],
  failedStep: null,
  logTail: [],
  waitingFor: [],
  queue: null,
  deployed: [],
  ended: false,
  ...over,
});

test("run_pipeline waits for the end and returns the failing step's output", async () => {
  let polls = 0;
  const result = await withFetch(
    (url) => {
      if (url.endsWith("/pipelines/run")) return Response.json(run({}));
      polls += 1;
      return Response.json(
        run({
          status: "failed",
          ended: true,
          stages: [{ name: "Test", status: "failed" }],
          failedStep: { stage: "Test", name: "npm test", exitCode: 1 },
          logTail: ["\u001b[31mFAIL\u001b[0m src/cart.test.ts", "Expected 3, got 2"],
        }),
      );
    },
    () => runPipelineTool.run(bridged(), { pipeline: "Shop CI" }),
  );
  assert.equal(polls, 1);
  assert.equal(result.isError, true);
  assert.match(result.output, /Shop CI #8: failed/);
  assert.match(result.output, /Failed at Test › npm test \(exit 1\)/);
  assert.match(
    result.output,
    /FAIL src\/cart\.test\.ts\nExpected 3, got 2/,
    "colour codes removed",
  );
});

test("run_pipeline stops at an approval and says the user's admin must answer it", async () => {
  const result = await withFetch(
    () =>
      Response.json(run({ status: "waiting", waitingFor: [{ message: "Deploy to production?" }] })),
    () => runPipelineTool.run(bridged(), { pipeline: "Shop CI" }),
  );
  assert.equal(result.isError, false);
  assert.match(
    result.output,
    /Waiting for a person: "Deploy to production\?"\. You cannot answer it/,
  );
});

test("run_pipeline reports the deployed link from the run, and a run still going", async () => {
  const done = await withFetch(
    () =>
      Response.json(
        run({
          status: "passed",
          ended: true,
          deployed: [
            {
              environment: "staging",
              app: "shop",
              status: "live",
              url: "https://shop.staging.example.com",
              error: null,
            },
          ],
        }),
      ),
    () => runPipelineTool.run(bridged(), { pipeline: "Shop CI" }),
  );
  assert.match(
    done.output,
    /Deployed to staging as shop: live at https:\/\/shop\.staging\.example\.com/,
  );

  const going = await withFetch(
    () => Response.json(run({})),
    () => runPipelineTool.run(bridged(), { pipeline: "Shop CI", wait_minutes: 0 }),
  );
  assert.match(going.output, /Still going when the wait ended\. pipeline_run .* number 8/);
});
