import { roleAtLeast, updateSettingsSchema, vaultNameSchema } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { SettingsService } from "../services/settings.js";

export function registerSettingsRoutes(
  app: FastifyInstance,
  deps: { settings: SettingsService; access: AccessControl; store: Store },
): void {
  app.get("/api/settings", async (request) => {
    deps.access.requireInstanceAdmin(request);
    return await deps.settings.describe();
  });

  app.put("/api/settings", async (request) => {
    deps.access.requireInstanceAdmin(request);
    const changes = updateSettingsSchema.parse(request.body);
    await deps.settings.update(changes);
    return await deps.settings.describe();
  });

  /**
   * What a credential field can be pointed at: the instance Vault, and every
   * team Vault the administrator is an admin or owner of — names only.
   */
  app.get("/api/settings/vault-choices", async (request) => {
    const user = deps.access.requireInstanceAdmin(request);
    const groups = [{ scope: "instance", label: "Instance", names: [] as string[] }];
    for (const team of await deps.store.teams.listForUser(user.id)) {
      if (roleAtLeast(team.role, "admin"))
        groups.push({ scope: team.id, label: team.name, names: [] });
    }
    for (const group of groups) {
      group.names = (await deps.store.vault.list(group.scope)).map((entry) => entry.name);
    }
    return { groups };
  });

  /**
   * Where a credential field takes its value from: a Vault secret (in the
   * instance Vault, or a team's the person administers), or nothing (null).
   * Typing a value goes through PUT /api/settings.
   */
  app.put<{ Params: { key: string } }>("/api/settings/:key/source", async (request) => {
    const user = deps.access.requireInstanceAdmin(request);
    const { vaultName, vault } = z
      .object({ vaultName: vaultNameSchema.nullable(), vault: z.string().min(1).optional() })
      .strict()
      .parse(request.body);
    const scope = vault ?? "instance";
    // A key used by Settings serves the whole instance, so a team's secret
    // may only be chosen by someone who administers that team.
    if (vaultName !== null && scope !== "instance") {
      await deps.access.requireTeamRole(user, scope, "admin");
    }
    await deps.settings.setCredentialSource(
      request.params.key,
      vaultName === null ? null : { name: vaultName, scope },
    );
    await deps.access.recordChange(user, {
      teamId: scope === "instance" ? null : scope,
      action: "settings.credential_source_changed",
      detail: { label: request.params.key, ...(vaultName ? { name: vaultName } : {}) },
    });
    return await deps.settings.describe();
  });

  // "Use the Claude Pro you already pay for" instead of a separate metered
  // key. Detection is a plain existence check, safe to
  // call whenever Settings renders; the actual read only ever happens on
  // the explicit "use this" click below.
  app.get("/api/settings/cli-sessions/anthropic", async (request) => {
    deps.access.requireInstanceAdmin(request);
    return { found: await deps.settings.detectAnthropicCliSession() };
  });

  app.post("/api/settings/cli-sessions/anthropic/use", async (request) => {
    deps.access.requireInstanceAdmin(request);
    await deps.settings.useAnthropicCliSession();
    return await deps.settings.describe();
  });

  // Same shape, for a Codex "sign in with ChatGPT" session.
  app.get("/api/settings/cli-sessions/openai", async (request) => {
    deps.access.requireInstanceAdmin(request);
    return { found: await deps.settings.detectOpenaiCliSession() };
  });

  app.post("/api/settings/cli-sessions/openai/use", async (request) => {
    deps.access.requireInstanceAdmin(request);
    await deps.settings.useOpenaiCliSession();
    return await deps.settings.describe();
  });
}
