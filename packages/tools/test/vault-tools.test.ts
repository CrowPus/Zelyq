import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolContext } from "../src/types.js";
import { listProjectVariablesTool } from "../src/vault.js";

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    projectId: "prj_x",
    runtime: {} as ToolContext["runtime"],
    signal: new AbortController().signal,
    onFileChanged: () => undefined,
    log: () => undefined,
    ...over,
  };
}

async function withFetch<T>(
  respond: (url: string, headers: Record<string, string>) => Response,
  run: () => Promise<T>,
): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) =>
    respond(String(url), Object.fromEntries(new Headers(init?.headers).entries()))) as never;
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

const bridged = () => ctx({ previewBridge: { url: "http://server", token: "grant" } });

test("list_project_variables refuses without the session's grant", async () => {
  const result = await listProjectVariablesTool.run(ctx(), {});
  assert.equal(result.isError, true);
});

test("it reads names through the bridge, marks Vault ones, and flags a missing one", async () => {
  const seen: { url: string; token?: string }[] = [];
  const result = await withFetch(
    (url, headers) => {
      seen.push({ url, token: headers["x-zelyq-preview-bridge"] });
      return Response.json({
        variables: [
          { name: "STRIPE_KEY", source: "vault", missing: false },
          { name: "MAIL_TOKEN", source: "direct", missing: false },
          { name: "OLD_KEY", source: "vault", missing: true },
        ],
      });
    },
    () => listProjectVariablesTool.run(bridged(), {}),
  );
  assert.deepEqual(seen, [
    { url: "http://server/api/internal/project-variables/names", token: "grant" },
  ]);
  assert.equal(result.isError, undefined);
  assert.match(result.output, /- STRIPE_KEY \(from Vault\)\n/);
  assert.match(result.output, /- MAIL_TOKEN\n/);
  assert.match(result.output, /OLD_KEY \(from Vault\) — NOT SET/);
  assert.match(result.output, /Never put one in browser code/);
});

test("no variables tells the agent to name what is needed rather than invent it", async () => {
  const result = await withFetch(
    () => Response.json({ variables: [] }),
    () => listProjectVariablesTool.run(bridged(), {}),
  );
  assert.match(result.output, /tell the user which names to add/);
});

test("a server refusal is an error the model can read, not a crash", async () => {
  const result = await withFetch(
    () => new Response("{}", { status: 401 }),
    () => listProjectVariablesTool.run(bridged(), {}),
  );
  assert.equal(result.isError, true);
});
