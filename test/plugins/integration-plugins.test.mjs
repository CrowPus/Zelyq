import assert from "node:assert/strict";
import { test } from "node:test";
import airtable from "../../plugins/airtable.mjs";
import cloudflare from "../../plugins/cloudflare.mjs";
import figma from "../../plugins/figma.mjs";
import github from "../../plugins/github.mjs";
import netlify from "../../plugins/netlify.mjs";
import { z } from "../../plugins/node_modules/zod/index.js";
import sentry from "../../plugins/sentry.mjs";
import stripe from "../../plugins/stripe.mjs";
import supabase from "../../plugins/supabase.mjs";
import vercel from "../../plugins/vercel.mjs";

const bundles = [github, cloudflare, figma, airtable, stripe, supabase, sentry, vercel, netlify];
const tools = bundles.flat();
function context() {
  const commands = [];
  const logs = [];
  return {
    commands,
    logs,
    value: {
      projectId: "p1",
      signal: new AbortController().signal,
      onFileChanged() {},
      log(message) {
        logs.push(message);
      },
      runtime: {
        async exec(_id, options) {
          commands.push(options.command);
          return {
            exitCode: 0,
            stdout: "{}",
            stderr: "",
            timedOut: false,
            truncated: false,
            durationMs: 1,
          };
        },
      },
    },
  };
}

test("all nine bundles export 27 unique loader-compatible tools", () => {
  assert.equal(tools.length, 27);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 27);
  for (const tool of tools) {
    assert.ok(
      tool.description.includes("Read-only") || /read|list|retrieve/i.test(tool.description),
    );
    assert.doesNotThrow(() => z.toJSONSchema(tool.schema, { io: "input" }));
  }
});

test("GitHub command references an environment variable without embedding a token", async () => {
  const ctx = context();
  await github[0].run(ctx.value, { owner: "openai", repo: "example" });
  assert.match(ctx.commands[0], /\$GITHUB_TOKEN/);
  assert.match(ctx.commands[0], /api\.github\.com\/repos\/openai\/example/);
  assert.doesNotMatch(ctx.logs.join(" "), /token=.*|Bearer/);
});

test("path segments and query values are encoded", async () => {
  const ctx = context();
  await airtable[2].run(ctx.value, {
    base_id: "base/id",
    table: "Road map",
    view: "All records",
    max_records: 25,
  });
  assert.match(ctx.commands[0], /base%2Fid\/Road%20map/);
  assert.match(ctx.commands[0], /view=All%20records/);
});

test("Stripe uses Basic Auth and does not create Checkout Sessions", async () => {
  const ctx = context();
  await stripe[2].run(ctx.value, { session_id: "cs_test_123" });
  assert.match(ctx.commands[0], /--user "\$STRIPE_SECRET_KEY:"/);
  assert.match(ctx.commands[0], /checkout\/sessions\/cs_test_123/);
  assert.doesNotMatch(ctx.commands[0], /--request POST/);
});

test("Supabase Data API expands fixed URL/key variables inside the runtime", async () => {
  const ctx = context();
  await supabase[2].run(ctx.value, { table: "todos", select: "id,title", limit: 10 });
  assert.match(ctx.commands[0], /"\$SUPABASE_URL"'\/rest\/v1\/todos/);
  assert.match(ctx.commands[0], /apikey: \$SUPABASE_API_KEY/);
});

test("Supabase filters remain single-quoted data and cannot become shell substitutions", async () => {
  const ctx = context();
  await supabase[2].run(ctx.value, {
    table: "todos",
    select: "*",
    limit: 10,
    filter_query: "title=eq.$(touch /tmp/should-not-run)'quoted",
  });
  assert.match(ctx.commands[0], /'"'"'/);
  assert.match(ctx.commands[0], /'\/rest\/v1\/todos/);
  const quotedPathStart = ctx.commands[0].indexOf('"$SUPABASE_URL"\'');
  const substitution = ctx.commands[0].indexOf("$(touch");
  const escapedApostrophe = ctx.commands[0].indexOf("'\"'\"'", substitution);
  assert.ok(quotedPathStart >= 0 && quotedPathStart < substitution);
  assert.ok(
    substitution < escapedApostrophe,
    "the substitution text must remain inside single quotes",
  );
});

test("deployment connectors only issue GET-style curl calls", async () => {
  const ctx = context();
  await cloudflare[2].run(ctx.value, { account_id: "a", project_name: "p", page: 1, per_page: 10 });
  await vercel[2].run(ctx.value, { limit: 10 });
  await netlify[2].run(ctx.value, { site_id: "s", page: 1, per_page: 10 });
  for (const command of ctx.commands)
    assert.doesNotMatch(command, /--request|--data|--upload-file/);
});
