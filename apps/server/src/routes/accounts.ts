import { ZelyqError } from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { AccountService } from "../services/accounts.js";
import type { AuthService } from "../services/auth.js";
import { SESSION_COOKIE } from "./auth.js";

const deleteSelfSchema = z.object({ password: z.string().min(1) });

export function registerAccountRoutes(
  app: FastifyInstance,
  deps: { accounts: AccountService; auth: AuthService; access: AccessControl },
): void {
  const requireInstanceAdmin = (request: Parameters<typeof deps.access.requireUser>[0]) => {
    const user = deps.access.requireUser(request);
    if (user.instanceRole !== "admin") {
      throw new ZelyqError("forbidden", "Only an instance administrator can do that.");
    }
    return user;
  };

  /**
   * Deleting your own account. The password is required because a session left
   * open on a shared machine should not be enough to destroy the account and
   * every project only you could reach.
   */
  app.delete("/api/auth/me", async (request, reply) => {
    const user = deps.access.requireUser(request);
    const { password } = deleteSelfSchema.parse(request.body ?? {});
    await deps.auth.confirmPassword(user, password);
    await deps.accounts.deleteUser(user, user.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.status(204);
  });

  app.get("/api/users", async (request) => {
    requireInstanceAdmin(request);
    return { users: await deps.accounts.list() };
  });

  app.delete<{ Params: { id: string } }>("/api/users/:id", async (request, reply) => {
    const admin = requireInstanceAdmin(request);
    await deps.accounts.deleteUser(admin, request.params.id);
    reply.status(204);
  });
}
