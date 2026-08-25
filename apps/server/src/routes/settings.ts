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
}
