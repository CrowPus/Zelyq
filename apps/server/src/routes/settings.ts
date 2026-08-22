import { updateSettingsSchema, ZelyqError } from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { SettingsService } from "../services/settings.js";

export function registerSettingsRoutes(
  app: FastifyInstance,
  deps: { settings: SettingsService; access: AccessControl },
): void {
  /**
   * Instance settings are not team-scoped, so team roles do not apply. Only an
   * instance administrator may read or change them — the values include API
   * keys and who is allowed to sign up.
   */
  const requireInstanceAdmin = (request: Parameters<typeof deps.access.requireUser>[0]) => {
    const user = deps.access.requireUser(request);
    if (user.instanceRole !== "admin") {
      throw new ZelyqError("forbidden", "Only an instance administrator can change settings.");
    }
    return user;
  };

  app.get("/api/settings", async (request) => {
    requireInstanceAdmin(request);
    return await deps.settings.describe();
  });

  app.put("/api/settings", async (request) => {
    requireInstanceAdmin(request);
    const changes = updateSettingsSchema.parse(request.body);
    await deps.settings.update(changes);
    return await deps.settings.describe();
  });
}
