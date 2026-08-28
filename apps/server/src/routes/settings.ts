import { updateSettingsSchema } from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { SettingsService } from "../services/settings.js";

export function registerSettingsRoutes(
  app: FastifyInstance,
  deps: { settings: SettingsService; access: AccessControl },
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
