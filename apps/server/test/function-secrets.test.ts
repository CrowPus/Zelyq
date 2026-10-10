import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { newId } from "@zelyq/core";
import { createStore, runMigrations, type Store } from "@zelyq/db";
import type { RuntimeDriver } from "@zelyq/runtime";
import { AccessControl } from "../src/services/access.js";
import { FunctionSecretSync } from "../src/services/function-secrets.js";
import { ProjectVariableService } from "../src/services/project-variables.js";
import { SecretBox } from "../src/services/secrets.js";
import { SupabaseConnectionService } from "../src/services/supabase-connections.js";
import { VaultService } from "../src/services/vault.js";

/**
 * A browser-only app's server side is a Supabase Edge Function. Its secrets
 * must equal the project's variables — and only what Zelyq set may ever be
 * removed from Supabase.
 */

const tmp = path.join(os.tmpdir(), `zelyq-fn-secrets-${Date.now()}`);
const dbUrl = `file:${path.join(tmp, "fn.db")}`;
let store: Store;
const box = new SecretBox(randomBytes(32));
const PAT = `sbp_TEST_${"z".repeat(40)}`;
const runtime = { stopPreview: async () => ({ status: "stopped" }) } as unknown as RuntimeDriver;

type Call = { method: string; url: string; body: unknown };

/** Supabase's Management API, as far as this needs it, recording every call. */
function supabaseApi(ref: string, options: { failSecrets?: boolean } = {}) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (status: number, body?: unknown) =>
      new Response(body === undefined ? "" : JSON.stringify(body), { status });
    if (/\/v1\/organizations$/.test(url)) return json(200, [{ id: "org_1" }]);
    if (url.endsWith(`/v1/projects/${ref}`))
      return json(200, { id: ref, name: "Fn", region: "eu-west-1", organization_id: "org_1" });
    if (url.endsWith(`/v1/projects/${ref}/api-keys`))
      return json(200, [{ type: "publishable", api_key: "sb_publishable_FNFN" }]);
    if (url.endsWith(`/v1/projects/${ref}/secrets`)) {
      if (options.failSecrets) return json(503);
      return method === "POST" ? json(201) : json(200, {});
    }
    return json(599);
  };
  return Object.assign(fn, { calls });
}

async function setup(suffix: string, api: ReturnType<typeof supabaseApi>, link = true) {
  const user = await store.users.create({
    id: newId("user"),
    email: `${suffix}@example.com`,
    name: "Owner",
    passwordHash: "x",
  });
  const team = await store.teams.create({ id: newId("team"), name: suffix, slug: `t-${suffix}` });
  await store.teams.addMember(team.id, user.id, "owner");
  const project = await store.projects.create({
    id: newId("project"),
    teamId: team.id,
    name: suffix,
    slug: suffix,
    description: null,
    template: "vite-react",
    status: "ready",
    statusMessage: null,
  });
  const access = new AccessControl(store);
  const supabase = new SupabaseConnectionService(store, box, access, { fetch: api as never });
  if (link) {
    const connection = await supabase.connectWithPat(user, PAT);
    const ref = `ref_${suffix}`;
    const resource = await supabase.linkExistingResource(user, connection.id, { projectRef: ref });
    await supabase.linkProjectToResource(user, project.id, team.id, resource.id);
  }
  const vault = new VaultService(store, box, access);
  const variables = new ProjectVariableService(store, box, access, vault, runtime);
  const sync = new FunctionSecretSync(store, access, supabase, variables);
  variables.onChanged = (projectId) => sync.sync(projectId);
  vault.listeners.teamEntryChanged = (teamId, name) => variables.vaultEntryChanged(teamId, name);
  return { user, team, project, vault, variables, sync };
}

const secretCalls = (calls: Call[]) => calls.filter((call) => call.url.endsWith("/secrets"));

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(dbUrl);
  store = createStore(dbUrl);
});

after(async () => {
  await store.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("a change to the variables sets them as the linked project's function secrets", async () => {
  const api = supabaseApi("ref_fs1");
  const { user, team, project, vault, variables, sync } = await setup("fs1", api);
  await vault.create(
    user,
    { kind: "team", teamId: team.id },
    { name: "MAIL_KEY_TEST", value: "m-1" },
  );
  await variables.create(user, project.id, { name: "STRIPE_KEY", value: "sk_test_1" });
  await variables.create(user, project.id, { name: "MAIL_KEY", vaultName: "MAIL_KEY_TEST" });

  const last = secretCalls(api.calls).at(-1);
  assert.equal(last?.method, "POST");
  assert.deepEqual(last?.body, [
    { name: "MAIL_KEY", value: "m-1" },
    { name: "STRIPE_KEY", value: "sk_test_1" },
  ]);
  const status = await sync.status(user, project.id);
  assert.deepEqual(status, {
    linked: true,
    names: ["MAIL_KEY", "STRIPE_KEY"],
    at: status.at,
    error: null,
  });
  assert.ok(!JSON.stringify(status).includes("sk_test_1"), "status carries names only");

  // A change in Vault reaches the function too.
  const entry = (await vault.list(user, { kind: "team", teamId: team.id }))[0];
  await vault.update(user, { kind: "team", teamId: team.id }, entry?.id ?? "", { value: "m-2" });
  assert.deepEqual(secretCalls(api.calls).at(-1)?.body, [
    { name: "MAIL_KEY", value: "m-2" },
    { name: "STRIPE_KEY", value: "sk_test_1" },
  ]);
});

test("a deleted variable is removed from Supabase; a secret set there by hand is not", async () => {
  const api = supabaseApi("ref_fs2");
  const { user, project, variables } = await setup("fs2", api);
  const keep = await variables.create(user, project.id, { name: "KEEP", value: "k" });
  const drop = await variables.create(user, project.id, { name: "DROP", value: "d" });
  await variables.remove(user, project.id, drop.id);

  const calls = secretCalls(api.calls);
  const deletes = calls.filter((call) => call.method === "DELETE");
  assert.deepEqual(deletes.at(-1)?.body, ["DROP"]);
  // Only names Zelyq itself set are ever candidates for removal.
  for (const call of deletes) {
    for (const name of call.body as string[]) assert.ok(["DROP", "KEEP"].includes(name));
  }
  assert.ok(keep);
});

test("a project not linked to Supabase calls nothing and says so", async () => {
  const api = supabaseApi("ref_none");
  const { user, project, variables, sync } = await setup("fs3", api, false);
  await variables.create(user, project.id, { name: "LOCAL_ONLY", value: "x" });
  assert.equal(secretCalls(api.calls).length, 0);
  assert.equal((await sync.status(user, project.id)).linked, false);
});

test("Supabase being down is recorded for the panel, not thrown at the person saving", async () => {
  const api = supabaseApi("ref_fs4", { failSecrets: true });
  const { user, project, variables, sync } = await setup("fs4", api);
  await variables.create(user, project.id, { name: "STILL_SAVED", value: "x" });
  const status = await sync.status(user, project.id);
  assert.match(status.error ?? "", /secrets failed \(503\)/);
  assert.equal((await variables.list(user, project.id)).length, 1, "the variable itself was saved");
});
