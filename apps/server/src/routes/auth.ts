import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
  ZelyqError,
} from "@zelyq/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthService } from "../services/auth.js";

export const SESSION_COOKIE = "zelyq_session";

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: { auth: AuthService; sessionTtlDays: () => Promise<number> },
): void {
  /**
   * Cookie, not a header. A token in localStorage is readable by any script on
   * the page; httpOnly is not, and the browser attaches it to the WebSocket
   * handshake for free.
   */
  const setSessionCookie = async (request: FastifyRequest, reply: FastifyReply, token: string) => {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // Only mark Secure on a connection that is already HTTPS — doing it
      // unconditionally makes sign-in fail silently on a plain-HTTP instance.
      secure: request.protocol === "https",
      maxAge: (await deps.sessionTtlDays()) * 24 * 60 * 60,
    });
  };

  const setOidcStateCookie = (request: FastifyRequest, reply: FastifyReply, value: string) => {
    reply.setCookie("zelyq_oidc_state", value, {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/auth/oidc",
      secure: request.protocol === "https",
      maxAge: 10 * 60,
    });
  };

  /** Lets the sign-in screen offer "create the first account" on a fresh install. */
  app.get("/api/auth/status", async () => ({
    firstRun: await deps.auth.isFirstRun(),
    oidcEnabled: deps.auth.oidcEnabled(),
  }));

  app.get("/api/auth/oidc/start", async (request, reply) => {
    const started = await deps.auth.oidcStart();
    setOidcStateCookie(request, reply, `${started.state}|${started.verifier}`);
    return reply.redirect(started.authorizationUrl);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/auth/oidc/callback",
    async (request, reply) => {
      const stateCookie = request.cookies.zelyq_oidc_state;
      reply.clearCookie("zelyq_oidc_state", { path: "/api/auth/oidc" });
      if (request.query.error || !request.query.code || !request.query.state || !stateCookie) {
        return reply.redirect("/signin?error=oidc");
      }
      const [signedState, verifier] = stateCookie.split("|");
      if (request.query.state !== signedState || !verifier)
        return reply.redirect("/signin?error=oidc");
      try {
        const result = await deps.auth.oidcComplete({
          code: request.query.code,
          state: signedState,
          verifier,
        });
        await setSessionCookie(request, reply, result.token);
        return reply.redirect("/signin");
      } catch (error) {
        request.log.warn({ error }, "OIDC sign-in failed");
        return reply.redirect("/signin?error=oidc");
      }
    },
  );

  app.post("/api/auth/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const { user, token } = await deps.auth.register(input);
    await setSessionCookie(request, reply, token);
    reply.status(201);
    return await deps.auth.describe(user);
  });

  app.post("/api/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const { user, token } = await deps.auth.login(input);
    await setSessionCookie(request, reply, token);
    return await deps.auth.describe(user);
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await deps.auth.logout(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.status(204);
  });

  app.patch("/api/auth/profile", async (request) => {
    const user = request.zelyqUser;
    if (!user) throw new ZelyqError("unauthorized", "Sign in to continue.");

    const input = updateProfileSchema.parse(request.body);
    const updated = await deps.auth.updateProfile(user, input);
    return await deps.auth.describe(updated);
  });

  app.post("/api/auth/password", async (request, reply) => {
    const user = request.zelyqUser;
    if (!user) throw new ZelyqError("unauthorized", "Sign in to continue.");

    const input = changePasswordSchema.parse(request.body);
    const { token } = await deps.auth.changePassword(user, input);

    // Every session was revoked, including this one; hand back a fresh cookie
    // so the person changing the password stays signed in here.
    await setSessionCookie(request, reply, token);
    return { changed: true };
  });

  app.get("/api/auth/me", async (request, reply) => {
    const user = request.zelyqUser;
    if (!user) {
      reply.status(401);
      return { error: { code: "unauthorized", message: "Not signed in." } };
    }
    return await deps.auth.describe(user);
  });
}
