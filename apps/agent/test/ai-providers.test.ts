import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  aiProviderCatalogText,
  buildUseAiProviderTool,
  loadAiProviders,
} from "../src/ai-providers.js";

const silent = { info() {}, warn() {} };
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "zelyq-aiproviders-"));
}
async function writeProvider(dir: string, slug: string, contents: string) {
  await fs.mkdir(path.join(dir, slug), { recursive: true });
  await fs.writeFile(path.join(dir, slug, "PROVIDER.md"), contents);
}

test("loadAiProviders builds a catalog and reads Agent.md", async () => {
  const dir = await tmpDir();
  await writeProvider(
    dir,
    "openai",
    `---\nname: openai\ndescription: "OpenAI GPT family via the official SDK."\n---\n# OpenAI\nprose\n`,
  );
  await writeProvider(dir, "acme", "# Acme LLM\n\nA fictional OpenAI-compatible endpoint.\n");
  await fs.writeFile(
    path.join(dir, "Agent.md"),
    "MUST: key stays in Supabase\nNEVER: key in bundle\n",
  );

  const r = await loadAiProviders(dir, undefined, silent);
  assert.equal(r.providers.length, 2);
  assert.equal(r.skipped.length, 0);
  assert.match(r.agentMd ?? "", /key stays in Supabase/);

  const openai = r.providers.find((p) => p.slug === "openai");
  assert.equal(openai?.description, "OpenAI GPT family via the official SDK.");
  // No front matter → first prose line becomes the description.
  const acme = r.providers.find((p) => p.slug === "acme");
  assert.match(acme?.description ?? "", /fictional OpenAI-compatible/);

  const catalog = aiProviderCatalogText(r.providers);
  assert.match(catalog, /- openai: OpenAI GPT family/);
  assert.match(catalog, /- acme: A fictional OpenAI-compatible/);
});

test("operator dir wins on a slug collision", async () => {
  const built = await tmpDir();
  const op = await tmpDir();
  await writeProvider(built, "openai", "---\ndescription: built-in note\n---\nbody\n");
  await writeProvider(op, "openai", "---\ndescription: operator override\n---\nbody\n");

  const r = await loadAiProviders(built, op, silent);
  assert.equal(r.providers.length, 1);
  assert.equal(r.providers[0]?.description, "operator override");
  assert.equal(r.providers[0]?.source, "operator");
});

test("a directory without PROVIDER.md is skipped, not fatal", async () => {
  const dir = await tmpDir();
  await fs.mkdir(path.join(dir, "empty"), { recursive: true });
  await writeProvider(dir, "openai", "---\ndescription: ok\n---\nbody\n");

  const r = await loadAiProviders(dir, undefined, silent);
  assert.equal(r.providers.length, 1);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0]?.reason ?? "", /has no PROVIDER\.md/);
});

test("use_ai_provider returns a body and refuses an unknown or unsafe slug", async () => {
  const dir = await tmpDir();
  await writeProvider(dir, "openai", "---\ndescription: d\n---\n# OpenAI body content\n");
  const { providers } = await loadAiProviders(dir, undefined, silent);
  const tool = buildUseAiProviderTool(providers);

  const ok = await tool.run({} as never, { slug: "openai" });
  assert.equal(ok.isError, undefined);
  assert.match(ok.output, /OpenAI body content/);

  const missing = await tool.run({} as never, { slug: "nope" });
  assert.equal(missing.isError, true);
  assert.match(missing.output, /No AI provider "nope"/);

  const unsafe = await tool.run({} as never, { slug: "../etc/passwd" });
  assert.equal(unsafe.isError, true);
});

test("the bundled ai-providers/ library loads with all eight providers + Agent.md", async () => {
  const r = await loadAiProviders(path.join(repoRoot, "ai-providers"), undefined, silent);
  const slugs = r.providers.map((p) => p.slug).sort();
  assert.deepEqual(slugs, [
    "anthropic",
    "google",
    "groq",
    "mistral",
    "openai",
    "openai-compatible",
    "openrouter",
    "xai",
  ]);
  assert.equal(r.skipped.length, 0);
  assert.match(r.agentMd ?? "", /key lives in Supabase/i);
  // Every file names its package and its docs URL.
  for (const p of r.providers) {
    assert.match(p.body, /npm i |npm install |OpenAI-compatible/i, `${p.slug} names a package`);
    assert.match(p.body, /https?:\/\//, `${p.slug} has a docs URL`);
  }
});
