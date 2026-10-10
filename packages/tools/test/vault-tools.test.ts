import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolContext } from "../src/types.js";
import { listVaultSecretsTool } from "../src/vault.js";

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

test("list_vault_secrets refuses without the session's grant", async () => {
  const result = await listVaultSecretsTool.run(ctx(), {});
  assert.equal(result.isError, true);
});

test("list_vault_secrets reads names through the bridge and says how to use them", async () => {
  const seen: { url: string; token?: string }[] = [];
  const result = await withFetch(
    (url, headers) => {
      seen.push({ url, token: headers["x-zelyq-preview-bridge"] });
      return Response.json({
        secrets: [
          { name: "STRIPE_KEY", environments: ["development", "production"] },
          { name: "MAIL_TOKEN", environments: ["production"] },
        ],
      });
    },
    () =>
      listVaultSecretsTool.run(
        ctx({ previewBridge: { url: "http://server", token: "grant" } }),
        {},
      ),
  );
  assert.deepEqual(seen, [{ url: "http://server/api/internal/vault/names", token: "grant" }]);
  assert.equal(result.isError, undefined);
  assert.match(result.output, /STRIPE_KEY \(development, production\)/);
  assert.match(result.output, /MAIL_TOKEN \(production\)/);
  assert.match(result.output, /Only development values reach the preview/);
});

test("an empty Vault tells the agent to name what is needed rather than invent it", async () => {
  const result = await withFetch(
    () => Response.json({ secrets: [] }),
    () => listVaultSecretsTool.run(ctx({ previewBridge: { url: "http://s", token: "t" } }), {}),
  );
  assert.match(result.output, /tell the user which names to add in Vault/);
});

test("a server refusal is an error the model can read, not a crash", async () => {
  const result = await withFetch(
    () => new Response("{}", { status: 401 }),
    () => listVaultSecretsTool.run(ctx({ previewBridge: { url: "http://s", token: "t" } }), {}),
  );
  assert.equal(result.isError, true);
});
