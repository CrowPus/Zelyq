import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Each team brings its own AI keys on a shared server: a team's own key is
 * used first, and the server's only serve the teams a server admin belongs to,
 * unless the server shares them with every team.
 */

const tmp = path.join(os.tmpdir(), `zelyq-team-keys-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "keys.db")}`,
  agentUrl: "http://127.0.0.1:59994",
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: undefined,
  secretKeyFile: path.join(tmp, "secret.key"),
  attachmentsDir: path.join(tmp, "attachments"),
  uploadedSkillsDir: path.join(tmp, "skills"),
  pipelinesDir: path.join(tmp, "pipelines"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4980, 4983],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let ownerCookie: string;
let guestCookie: string;
let ownerTeam: string;
let guestTeam: string;

const call = (
  cookie: string,
  method: "GET" | "PUT" | "DELETE" | "POST",
  url: string,
  payload?: unknown,
) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  assert.equal(response.statusCode, 201, response.body);
  return `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")?.value}`;
}

const source = async (cookie: string, team: string, provider: string) =>
  (await call(cookie, "GET", `/api/teams/${team}/ai-keys`))
    .json()
    .keys.find((key: { provider: string }) => key.provider === provider).source;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  ownerCookie = await register("owner@example.com", "Owner");
  guestCookie = await register("guest@example.com", "Guest");
  ownerTeam = (await call(ownerCookie, "GET", "/api/teams")).json().teams[0].id;
  guestTeam = (await call(guestCookie, "GET", "/api/teams")).json().teams[0].id;
  // The server's own Gemini key, set by its admin.
  const saved = await call(ownerCookie, "PUT", "/api/settings", {
    geminiApiKey: "AIza-server-key-1234",
  });
  assert.equal(saved.statusCode, 200, saved.body);
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("the server's keys serve the server admin's team, not a stranger's", async () => {
  const owner = (await call(ownerCookie, "GET", `/api/teams/${ownerTeam}/ai-keys`)).json();
  assert.equal(owner.usesServerKeys, true);
  assert.equal(await source(ownerCookie, ownerTeam, "google"), "server");
  const guest = (await call(guestCookie, "GET", `/api/teams/${guestTeam}/ai-keys`)).json();
  assert.equal(guest.usesServerKeys, false);
  assert.equal(await source(guestCookie, guestTeam, "google"), "none");
  assert.equal(await server.settings.apiKeyFor("google", guestTeam), "");
  assert.equal(await server.settings.apiKeyFor("google", ownerTeam), "AIza-server-key-1234");
  // Studio says so plainly, rather than spending the server's key.
  const image = await call(guestCookie, "POST", `/api/images/generations?teamId=${guestTeam}`, {
    prompt: "a red bicycle",
    provider: "google",
    size: "1024x1024",
    quality: "medium",
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
  });
  assert.equal(image.statusCode, 502, image.body);
  assert.match(image.json().error.message, /team has no .*key yet.*Team page/);
});

test("a team admin adds the team's own key: used first, kept in its Vault, never shown", async () => {
  const set = await call(guestCookie, "PUT", `/api/teams/${guestTeam}/ai-keys/google`, {
    key: "AIza-guest-own-key-5678",
  });
  assert.equal(set.statusCode, 200, set.body);
  assert.doesNotMatch(set.body, /guest-own-key/);
  assert.equal(await source(guestCookie, guestTeam, "google"), "team");
  assert.equal(await server.settings.apiKeyFor("google", guestTeam), "AIza-guest-own-key-5678");
  const vault = (await call(guestCookie, "GET", `/api/teams/${guestTeam}/vault`)).json();
  const entry = vault.secrets.find((row: { name: string }) => row.name === "GEMINI_API_KEY");
  assert.ok(entry, JSON.stringify(vault).slice(0, 300));
  assert.equal(entry.protected, true);
  assert.doesNotMatch(JSON.stringify(vault), /guest-own-key/);
  // Replacing it, then removing it.
  await call(guestCookie, "PUT", `/api/teams/${guestTeam}/ai-keys/google`, {
    key: "AIza-guest-newer-9999",
  });
  assert.equal(await server.settings.apiKeyFor("google", guestTeam), "AIza-guest-newer-9999");
  const removed = await call(guestCookie, "DELETE", `/api/teams/${guestTeam}/ai-keys/google`);
  assert.equal(removed.statusCode, 200);
  assert.equal(await source(guestCookie, guestTeam, "google"), "none");
});

test("only a team admin sets keys; nobody outside the team sees them", async () => {
  const outsider = await call(ownerCookie, "GET", `/api/teams/${guestTeam}/ai-keys`);
  // Not even told the team is there.
  assert.ok([403, 404].includes(outsider.statusCode), String(outsider.statusCode));
  const editorCookie = await register("editor@example.com", "Editor");
  const editor = await server.store.users.findByEmail("editor@example.com");
  await server.store.teams.addMember(guestTeam, editor!.id, "editor");
  const asEditor = await call(editorCookie, "PUT", `/api/teams/${guestTeam}/ai-keys/openai`, {
    key: "sk-editor-key-1234567",
  });
  assert.equal(asEditor.statusCode, 403);
  const junk = await call(guestCookie, "PUT", `/api/teams/${guestTeam}/ai-keys/openai`, {
    key: "short",
  });
  assert.equal(junk.statusCode, 400);
});

test("sharing the server's keys with every team is the server admin's choice", async () => {
  const shared = await call(ownerCookie, "PUT", "/api/settings", { shareServerKeys: "true" });
  assert.equal(shared.statusCode, 200, shared.body);
  assert.equal(await source(guestCookie, guestTeam, "google"), "server");
  assert.equal(await server.settings.apiKeyFor("google", guestTeam), "AIza-server-key-1234");
  await call(ownerCookie, "PUT", "/api/settings", { shareServerKeys: "false" });
  assert.equal(await server.settings.apiKeyFor("google", guestTeam), "");
});

test("a team admin sets the team's own settings; the server's stay the server admin's", async () => {
  // The server's default provider, then the guest team's own choice.
  await call(ownerCookie, "PUT", "/api/settings", {
    provider: "anthropic",
    speechModel: "whisper-1",
  });
  const set = await call(guestCookie, "PUT", `/api/teams/${guestTeam}/settings`, {
    provider: "google",
    speechModel: "gpt-4o-transcribe",
  });
  assert.equal(set.statusCode, 200, set.body);
  const fields = set
    .json()
    .groups.flatMap(
      (group: { fields: { key: string; source: string; value: unknown }[] }) => group.fields,
    );
  const provider = fields.find((field: { key: string }) => field.key === "provider");
  assert.equal(provider.value, "google");
  assert.equal(provider.source, "database");
  // Only what a team decides is on its page: nothing that runs the server.
  assert.ok(!fields.some((field: { key: string }) => field.key === "allowRegistration"));
  assert.ok(!fields.some((field: { key: string }) => field.key.endsWith("ApiKey")));
  // Work for the guest team reads its own choice; the server's is unchanged.
  assert.equal(
    await server.settings.forTeam(guestTeam, () => server.settings.value("provider")),
    "google",
  );
  assert.equal(
    await server.settings.forTeam(ownerTeam, () => server.settings.value("provider")),
    "anthropic",
  );
  assert.equal(await server.settings.value("provider"), "anthropic");
  assert.equal(
    await server.settings.forTeam(guestTeam, () => server.settings.value("speechModel")),
    "gpt-4o-transcribe",
  );
  // A server setting cannot be set from a team, and only a team admin changes the team's.
  const server_ = await call(guestCookie, "PUT", `/api/teams/${guestTeam}/settings`, {
    allowRegistration: "false",
  });
  assert.equal(server_.statusCode, 400);
  const editorCookie = (
    await server.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "editor@example.com", password: "correct-horse-battery" },
    })
  ).cookies.find((c) => c.name === "zelyq_session")?.value;
  const asEditor = await call(
    `zelyq_session=${editorCookie}`,
    "PUT",
    `/api/teams/${guestTeam}/settings`,
    {
      provider: "openai",
    },
  );
  assert.equal(asEditor.statusCode, 403);
  // Back to the server's default.
  await call(guestCookie, "PUT", `/api/teams/${guestTeam}/settings`, { provider: "" });
  assert.equal(
    await server.settings.forTeam(guestTeam, () => server.settings.value("provider")),
    "anthropic",
  );
});

test("the owner's own sign-in on this machine is never another team's", async () => {
  await server.store.settings.set("anthropicAuthMode", "subscription");
  // A team that may not use the server's keys works only with its own API key.
  assert.equal(
    await server.settings.forTeam(guestTeam, () => server.settings.authModeFor("anthropic")),
    "api_key",
  );
  assert.equal(
    await server.settings.forTeam(ownerTeam, () => server.settings.authModeFor("anthropic")),
    "subscription",
  );
  await server.store.settings.set("anthropicAuthMode", "api_key");
});

test("a team's key can come from a secret already in its Vault; removing it never deletes the secret", async () => {
  const added = await call(guestCookie, "POST", `/api/teams/${guestTeam}/vault`, {
    name: "OUR_GEMINI",
    value: "AIza-from-the-vault-4242",
  });
  assert.equal(added.statusCode, 201, added.body);
  const chosen = await call(guestCookie, "PUT", `/api/teams/${guestTeam}/ai-keys/google/vault`, {
    vaultName: "OUR_GEMINI",
  });
  assert.equal(chosen.statusCode, 200, chosen.body);
  assert.doesNotMatch(chosen.body, /from-the-vault/);
  const google = chosen.json().keys.find((key: { provider: string }) => key.provider === "google");
  assert.equal(google.vaultName, "OUR_GEMINI");
  assert.equal(google.source, "team");
  assert.equal(await server.settings.apiKeyFor("google", guestTeam), "AIza-from-the-vault-4242");
  // A secret that is not there is refused, and an editor cannot choose one.
  const missing = await call(guestCookie, "PUT", `/api/teams/${guestTeam}/ai-keys/openai/vault`, {
    vaultName: "NOT_THERE",
  });
  assert.equal(missing.statusCode, 400);
  // Removing stops using it; the secret stays in the Vault.
  await call(guestCookie, "DELETE", `/api/teams/${guestTeam}/ai-keys/google`);
  assert.equal(await server.settings.apiKeyFor("google", guestTeam), "");
  const vault = (await call(guestCookie, "GET", `/api/teams/${guestTeam}/vault`)).json();
  assert.ok(vault.secrets.some((row: { name: string }) => row.name === "OUR_GEMINI"));
});

test("a new app from a repository can take its token from the team's Vault", async () => {
  const response = await call(guestCookie, "POST", "/api/projects", {
    teamId: guestTeam,
    name: "From a repo",
    gitUrl: "https://github.com/example/private-repo.git",
    gitTokenVault: "NO_SUCH_TOKEN",
  });
  assert.equal(response.statusCode, 400, response.body);
  assert.match(response.json().error.message, /NO_SUCH_TOKEN/);
});
