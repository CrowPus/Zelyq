import assert from "node:assert/strict";
import { test } from "node:test";
import {
  supabaseApplyMigrationTool,
  supabaseDeployFunctionTool,
  supabaseVerifyBackendTool,
} from "../src/supabase.js";
import type { ToolContext } from "../src/types.js";

/**
 * The migration tools call the Zelyq server through the
 * session bridge. With no bridge on the context (no Supabase linked) they
 * refuse cleanly instead of doing anything.
 */

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    projectId: "prj_x",
    runtime: {
      // Only readFile is exercised here.
      readFile: async () => ({
        path: "supabase/migrations/0001_init.sql",
        content: "create table t (id uuid);",
        encoding: "utf8",
      }),
    } as unknown as ToolContext["runtime"],
    signal: new AbortController().signal,
    onFileChanged: () => undefined,
    log: () => undefined,
    ...over,
  };
}

test("supabase_apply_migration refuses when no bridge is present", async () => {
  const result = await supabaseApplyMigrationTool.run(ctx(), {
    name: "0001_init",
    path: "supabase/migrations/0001_init.sql",
  });
  assert.equal(result.isError, true);
  assert.match(result.output, /No Supabase backend is linked/);
});

test("supabase_verify_backend refuses when no bridge is present", async () => {
  const result = await supabaseVerifyBackendTool.run(ctx(), {});
  assert.equal(result.isError, true);
  assert.match(result.output, /No Supabase backend is linked/);
});

test("supabase_apply_migration posts to the bridge with the token header", async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return new Response(
      JSON.stringify({ name: "0001_init", checksum: "abc", alreadyApplied: false }),
      {
        status: 200,
      },
    );
  }) as typeof fetch;
  try {
    const result = await supabaseApplyMigrationTool.run(
      ctx({ supabaseBridge: { url: "http://server.local", token: "brdg_secret" } }),
      { name: "0001_init", path: "supabase/migrations/0001_init.sql" },
    );
    assert.equal(result.isError ?? false, false, result.output);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://server.local/api/internal/supabase/apply-migration");
    assert.equal(calls[0].headers["x-zelyq-supabase-bridge"], "brdg_secret");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("supabase_deploy_function refuses when no bridge is present", async () => {
  const result = await supabaseDeployFunctionTool.run(ctx(), {
    slug: "save-credential",
    path: "supabase/functions/save-credential/index.ts",
  });
  assert.equal(result.isError, true);
  assert.match(result.output, /No Supabase backend is linked/);
});

test("supabase_deploy_function posts the function source to the bridge", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ slug: "chat", created: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await supabaseDeployFunctionTool.run(
      ctx({
        supabaseBridge: { url: "http://server.local", token: "brdg_secret" },
        runtime: {
          readFile: async () => ({
            path: "supabase/functions/chat/index.ts",
            content: "Deno.serve(() => new Response('ok'));",
            encoding: "utf8",
          }),
        } as unknown as ToolContext["runtime"],
      }),
      { slug: "chat", path: "supabase/functions/chat/index.ts" },
    );
    assert.equal(result.isError ?? false, false, result.output);
    assert.match(result.output, /created and deployed/);
    assert.equal(calls[0].url, "http://server.local/api/internal/supabase/deploy-function");
    assert.equal((calls[0].body as { slug: string }).slug, "chat");
    assert.match((calls[0].body as { source: string }).source, /Deno\.serve/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("supabase_deploy_function surfaces the manual-deploy fallback message on failure", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: {
          message:
            'Automatic deploy of "chat" failed (Supabase API POST failed (400)). Deploy it by hand: run `supabase functions deploy chat`.',
        },
      }),
      { status: 400 },
    )) as typeof fetch;
  try {
    const result = await supabaseDeployFunctionTool.run(
      ctx({
        supabaseBridge: { url: "http://server.local", token: "t" },
        runtime: {
          readFile: async () => ({ path: "p", content: "code", encoding: "utf8" }),
        } as unknown as ToolContext["runtime"],
      }),
      { slug: "chat", path: "supabase/functions/chat/index.ts" },
    );
    assert.equal(result.isError, true);
    assert.match(result.output, /supabase functions deploy chat/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
