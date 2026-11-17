import {
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  isZelyqError,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  ZelyqError,
} from "@zelyq/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthService } from "../services/auth.js";
import type { EmailLinkService } from "../services/email-links.js";

export const SESSION_COOKIE = "zelyq_session";

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: { auth: AuthService; links: EmailLinkService; sessionTtlDays: () => Promise<number> },
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
  // "Forgot password?" shows only when a reset email could actually arrive and lead back here.
  // Self-hosted or managed (connected to an account service) — see AuthService.instanceStatus.
  app.get("/api/auth/status", async () =>
    deps.auth.instanceStatus((await deps.links.availability()).available),
  );

  /**
   * The same answer whether or not the address has an account: nobody learns
   * who is registered here by asking.
   */
  app.post(
    "/api/auth/forgot-password",
    // Per address the service allows 3 an hour; this caps one connection across all addresses.
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = forgotPasswordSchema.parse(request.body);
      // The same answer either way; managed, a reset goes out only for an administrator.
      if (await deps.auth.mayResetPassword(input.email)) await deps.links.requestReset(input.email);
      reply.status(202);
      return { sent: true };
    },
  );

  app.post(
    "/api/auth/reset-password",
    { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = resetPasswordSchema.parse(request.body);
      const user = await deps.links.resetPassword(input.token, input.password);
      await setSessionCookie(request, reply, await deps.links.session(user.id));
      return await deps.auth.describe(user);
    },
  );

  /** What an invitation is for, before accepting it. POST so the token never sits in a URL. */
  app.post(
    "/api/auth/invite/lookup",
    { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } },
    async (request) => {
      const input = acceptInviteSchema.pick({ token: true }).parse(request.body);
      return await deps.links.describeInvite(input.token);
    },
  );

  app.post(
    "/api/auth/invite/accept",
    { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = acceptInviteSchema.parse(request.body);
      // Managed: a new person signs in through the account service first, then accepts.
      if (!request.zelyqUser) deps.auth.requireLocal(null, "Sign in or create your account");
      const accepted = await deps.links.acceptInvite(
        input.token,
        { name: input.name, password: input.password },
        request.zelyqUser ?? null,
      );
      if (accepted.created) {
        await setSessionCookie(request, reply, await deps.links.session(accepted.user.id));
      }
      return { ...(await deps.auth.describe(accepted.user)), teamId: accepted.teamId };
    },
  );

  /**
   * `?return_to=/a/path`: where to land once signed in (a shared link, an
   * invitation). Only a path on this server; anything else lands on the start.
   */
  app.get<{ Querystring: { return_to?: string } }>(
    "/api/auth/oidc/start",
    async (request, reply) => {
      const started = await deps.auth.oidcStart();
      const back = safeReturnTo(request.query.return_to);
      setOidcStateCookie(
        request,
        reply,
        `${started.state}|${started.verifier}${back ? `|${Buffer.from(back).toString("base64url")}` : ""}`,
      );
      return reply.redirect(started.authorizationUrl);
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/auth/oidc/callback",
    async (request, reply) => {
      const stateCookie = request.cookies.zelyq_oidc_state;
      reply.clearCookie("zelyq_oidc_state", { path: "/api/auth/oidc" });
      if (request.query.error || !request.query.code || !request.query.state || !stateCookie) {
        return reply.redirect("/signin?error=oidc");
      }
      const [signedState, verifier, encodedBack] = stateCookie.split("|");
      const back = encodedBack
        ? safeReturnTo(Buffer.from(encodedBack, "base64url").toString())
        : null;
      if (request.query.state !== signedState || !verifier)
        return reply.redirect("/signin?error=oidc");
      try {
        const result = await deps.auth.oidcComplete({
          code: request.query.code,
          state: signedState,
          verifier,
        });
        await setSessionCookie(request, reply, result.token);
        return reply.redirect(back ?? "/signin");
      } catch (error) {
        request.log.warn({ error }, "OIDC sign-in failed");
        // Said plainly, but the reason itself never rides in the address: a link
        // with words of someone else's choosing on our sign-in page is a phishing tool.
        if (isZelyqError(error) && error.details?.reason === "suspended") {
          return reply.redirect("/signin?error=suspended");
        }
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
    if (input.email !== undefined && input.email.trim().toLowerCase() !== user.email) {
      deps.auth.requireLocal(user, "Change your email");
    }
    const updated = await deps.auth.updateProfile(user, input);
    return await deps.auth.describe(updated);
  });

  app.post("/api/auth/password", async (request, reply) => {
    const user = request.zelyqUser;
    if (!user) throw new ZelyqError("unauthorized", "Sign in to continue.");

    deps.auth.requireLocal(user, "Change your password");
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

/**
 * A path on this server to go back to after signing in, or null. Never
 * another site: no scheme, no `//host`, no backslash tricks, nothing odd.
 */
export function safeReturnTo(value: string | undefined): string | null {
  if (!value || value.length > 2000) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127 || ch === "\\") return null;
  }
  if (value.startsWith("/api/") || value.startsWith("/signin")) return null;
  return value;
}
