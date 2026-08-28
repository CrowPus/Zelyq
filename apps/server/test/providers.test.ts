import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * The model picker's "configured" and "default". Connecting a Claude Code
 * session must make Anthropic show up in the composer's `/` menu or the
 * model picker; `/api/providers` used to only relay the agent's own
 * env-only check, never anything Settings actually knows about. A minimal
 * stand-in agent server here, not a real
 * one, so this proves the *merge* logic — the agent's own response reports
 * nothing configured for any provider, on purpose, so a pass here can only
 * mean the server-side settings check is what's actually doing the work.
 */

const tmp = path.join(os.tmpdir(), `zelyq-providers-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

const fakeAgent = http.createServer((req, res) => {
  if (req.url === "/providers") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        default: "google",
        providers: [
          {
            id: "anthropic",
            label: "Claude",
            defaultModel: "claude-opus-5",
            apiKeyEnv: ["ANTHROPIC_API_KEY"],
            docsUrl: "https://x",
            configured: false,
          },
          {
            id: "google",
            label: "Gemini",
            defaultModel: "gemini-3.7-flash",
            apiKeyEnv: ["GEMINI_API_KEY"],
            docsUrl: "https://x",
            configured: false,
          },
          {
            id: "openai",
            label: "OpenAI",
            defaultModel: "gpt-5.1",
            apiKeyEnv: ["OPENAI_API_KEY"],
            docsUrl: "https://x",
            configured: false,
            models: [{ value: "gpt-5.1", label: "GPT-5.1" }],
          },
        ],
      }),
    );
    return;
  }
  res.statusCode = 404;
  res.end();
});

let agentBase = "";

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "providers.db")}`,
  agentUrl: "",
  provider: "google",
  model: "claude-opus-5",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: randomBytes(32).toString("base64"),
  secretKeyFile: path.join(tmp, "secret.key"),
  attachmentsDir: path.join(tmp, "attachments"),
  uploadedSkillsDir: path.join(tmp, "skills"),
  codexCredentialsPath: path.join(tmp, "codex-auth.json"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4974, 4977],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let cookie: string;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await new Promise<void>((resolve) => fakeAgent.listen(0, "127.0.0.1", resolve));
  const address = fakeAgent.address();
  const port = typeof address === "object" && address ? address.port : 0;
  agentBase = `http://127.0.0.1:${port}`;
  config.agentUrl = agentBase;

  await runMigrations(config.databaseUrl);
  server = await buildServer(config);

  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "owner@example.com", name: "Owner", password: "correct-horse-battery" },
  });
  cookie = `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")!.value}`;
});

after(async () => {
  await server.close();
  await new Promise<void>((resolve) => fakeAgent.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
});

test("a provider configured only in Settings, not the agent's own env, still shows as configured", async () => {
  await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie },
    payload: { anthropicApiKey: "sk-ant-from-settings" },
  });

  const response = await server.app.inject({
    method: "GET",
    url: "/api/providers",
    headers: { cookie },
  });
  const body = response.json();
  const anthropic = body.providers.find((p: { id: string }) => p.id === "anthropic");
  const google = body.providers.find((p: { id: string }) => p.id === "google");

  assert.equal(
    anthropic.configured,
    true,
    "the agent's own response said false — Settings must win",
  );
  assert.equal(google.configured, false, "nothing was ever configured for Gemini here");
});

test("the picker's default follows the live setting, not whatever the agent booted with", async () => {
  await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie },
    payload: { provider: "anthropic" },
  });

  const response = await server.app.inject({
    method: "GET",
    url: "/api/providers",
    headers: { cookie },
  });
  // The fake agent always reports "google" as its own default — a pass
  // here can only come from the live settings value winning instead.
  assert.equal(response.json().default, "anthropic");
});

test("a connected Codex session swaps the composer's model list, not just the Settings-page suggestions", async () => {
  // Fixing Settings' own suggestions alone misses the
  // *other* place a model gets picked from — the composer's own `/`
  // model picker, the one actually used daily — left it looking
  // completely unchanged, still offering the ordinary API's "gpt-5.1"
  // that a real Codex session had already rejected.
  await fs.writeFile(
    path.join(tmp, "codex-auth.json"),
    JSON.stringify({ tokens: { access_token: "tok", account_id: "acc_picker_test" } }),
  );
  await server.app.inject({
    method: "POST",
    url: "/api/settings/cli-sessions/openai/use",
    headers: { cookie },
  });

  const response = await server.app.inject({
    method: "GET",
    url: "/api/providers",
    headers: { cookie },
  });
  const openai = response.json().providers.find((p: { id: string }) => p.id === "openai");

  assert.ok(
    !openai.models.some((m: { value: string }) => m.value === "gpt-5.1"),
    "the ordinary API's model must not still be offered for a connected Codex session",
  );
  assert.ok(openai.models.length > 0);
});
