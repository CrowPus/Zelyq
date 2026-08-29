import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { newId } from "@zelyq/core";
import { createStore, runMigrations, type Store } from "@zelyq/db";
import { AccessControl } from "../src/services/access.js";
import { SecretBox } from "../src/services/secrets.js";
import { SupabaseBridge } from "../src/services/supabase-bridge.js";
import { SupabaseConnectionService } from "../src/services/supabase-connections.js";

/**
 * 058 · Phase C — the bridge hands the agent a session-scoped capability, never
 * the Management credential. These tests cover the token lifecycle.
 */

const tmp = path.join(os.tmpdir(), `zelyq-supabase-bridge-${Date.now()}`);
const dbUrl = `file:${path.join(tmp, "bridge.db")}`;
let store: Store;
let bridge: SupabaseBridge;

async function projectWithLink(suffix: string): Promise<string> {
  const user = await store.users.create({
    id: newId("user"),
    email: `u-${suffix}@example.com`,
    name: "U",
    passwordHash: "x",
  });
  const team = await store.teams.create({ id: newId("team"), name: suffix, slug: `t-${suffix}` });
  await store.teams.addMember(team.id, user.id, "owner");
  const project = await store.projects.create({
    id: newId("project"),
    teamId: team.id,
    name: suffix,
    slug: `p-${suffix}`,
    description: null,
    template: "vite-react",
    status: "ready",
    statusMessage: null,
  });

  const secrets = new SecretBox(randomBytes(32));
  const stub = async (url: string): Promise<Response> => {
    if (/\/v1\/organizations$/.test(url)) return new Response("[]", { status: 200 });
    if (/\/v1\/projects\/ref_x$/.test(url)) {
      return new Response(
        JSON.stringify({ id: "ref_x", name: "X", region: "us-east-1", organization_id: "o" }),
        { status: 200 },
      );
    }
    if (/api-keys$/.test(url)) {
      return new Response(JSON.stringify([{ type: "publishable", api_key: "pub" }]), {
        status: 200,
      });
    }
    return new Response("{}", { status: 200 });
  };
  const svc = new SupabaseConnectionService(store, secrets, new AccessControl(store), {
    fetch: stub as never,
  });
  const conn = await svc.connectWithPat(user, "sbp_token_1234567890");
  const resource = await svc.linkExistingResource(user, conn.id, { projectRef: "ref_x" });
  await svc.linkProjectToResource(user, project.id, team.id, resource.id);
  return project.id;
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(dbUrl);
  store = createStore(dbUrl);
  bridge = new SupabaseBridge(store);
});

after(async () => {
  await store.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("mint returns null when the project has no linked Supabase resource", async () => {
  const project = await store.projects.create({
    id: newId("project"),
    teamId: (await store.teams.create({ id: newId("team"), name: "n", slug: "s-nolink" })).id,
    name: "no-link",
    slug: "p-nolink",
    description: null,
    template: "vite-react",
    status: "ready",
    statusMessage: null,
  });
  assert.equal(await bridge.mint("ses_1", project.id, "usr_1"), null);
});

test("mint returns a token for a linked project; resolve maps it back to project + user", async () => {
  const projectId = await projectWithLink("linked");
  const token = await bridge.mint("ses_2", projectId, "usr_owner");
  assert.ok(token && token.length > 20);
  const grant = bridge.resolve(token as string);
  assert.deepEqual(grant, { projectId, userId: "usr_owner" });
});

test("resolve returns null for an unknown token and after revokeSession", async () => {
  assert.equal(bridge.resolve("not-a-real-token"), null);
  const projectId = await projectWithLink("revoke");
  const token = (await bridge.mint("ses_3", projectId, "usr_x")) as string;
  assert.ok(bridge.resolve(token));
  bridge.revokeSession("ses_3");
  assert.equal(bridge.resolve(token), null);
});

test("minting again for the same session invalidates the old token", async () => {
  const projectId = await projectWithLink("remint");
  const first = (await bridge.mint("ses_4", projectId, "usr_y")) as string;
  const second = (await bridge.mint("ses_4", projectId, "usr_y")) as string;
  assert.notEqual(first, second);
  assert.equal(bridge.resolve(first), null);
  assert.ok(bridge.resolve(second));
});
