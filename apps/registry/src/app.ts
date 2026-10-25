import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { MAX_PLUGIN_PACKAGE_BYTES } from "@zelyq/core/node";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { RegistryConfig } from "./config.js";
import { openRegistryDb, type RegistryDb } from "./db.js";
import { loadSigner, type Signer } from "./signing.js";
import { RegistryError, RegistryStore } from "./store.js";

const SESSION = "zr_session";

export interface Registry {
  app: FastifyInstance;
  store: RegistryStore;
  signer: Signer;
  close(): Promise<void>;
}

const html = (text: unknown) =>
  String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * Zelyq's plugin registry. Two doors:
 *
 * - `/v1/…` for Zelyq installations: each registers itself once and sends its
 *   key with every call. Packages come with our signature; Zelyq verifies it.
 * - `/admin` for us: sign in, publish a version, withdraw one.
 *
 * There is no public catalog page: the plugins are seen from inside Zelyq.
 */
export async function buildRegistry(config: RegistryConfig): Promise<Registry> {
  const db: RegistryDb = await openRegistryDb(config.dataDir);
  const signer = loadSigner(config.dataDir);
  const store = new RegistryStore(db, signer, config.dataDir);

  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: MAX_PLUGIN_PACKAGE_BYTES + 1024, files: 1, fields: 5 },
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RegistryError) {
      reply.code(error.status).send({ error: error.message });
      return;
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      reply.code(status).send({ error: (error as Error).message });
      return;
    }
    app.log.error(error);
    reply.code(500).send({ error: "Something went wrong." });
  });

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/", async (_request, reply) =>
    reply
      .type("text/plain; charset=utf-8")
      .send("Zelyq plugin registry. Plugins are browsed and installed from inside Zelyq."),
  );

  // ------------------------------------------------------- for installations

  const installation = async (request: FastifyRequest) => {
    const header = request.headers.authorization ?? "";
    const key = header.replace(/^Bearer\s+/i, "").trim();
    if (!key.startsWith("zrk_")) {
      throw new RegistryError("Only a Zelyq installation can use the registry.", 401);
    }
    return store.installationFor(key);
  };

  app.post(
    "/v1/installations",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const body = (request.body ?? {}) as { zelyqVersion?: unknown };
      reply.code(201);
      return store.registerInstallation(
        typeof body.zelyqVersion === "string" ? body.zelyqVersion : null,
      );
    },
  );

  app.get("/v1/keys", async () => ({ keys: [{ id: signer.keyId, publicKey: signer.publicKey }] }));

  app.get<{ Querystring: { q?: string; category?: string } }>(
    "/v1/plugins",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request) => {
      await installation(request);
      return {
        plugins: await store.list({
          ...(request.query.q ? { q: request.query.q } : {}),
          ...(request.query.category ? { category: request.query.category } : {}),
        }),
      };
    },
  );

  app.get<{ Params: { publisher: string; name: string } }>(
    "/v1/plugins/:publisher/:name",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request) => {
      await installation(request);
      const plugin = await store.detail(`${request.params.publisher}/${request.params.name}`);
      if (!plugin) throw new RegistryError("No such plugin.", 404);
      return { plugin };
    },
  );

  app.get<{ Params: { publisher: string; name: string; version: string } }>(
    "/v1/plugins/:publisher/:name/:version/package",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id: installationId } = await installation(request);
      const id = `${request.params.publisher}/${request.params.name}`;
      const found = await store.package(id, request.params.version);
      await store.recordDownload(id, request.params.version, installationId);
      reply
        .type("application/gzip")
        .header("x-zelyq-sha256", found.sha256)
        .header("x-zelyq-signature", found.signature)
        .header("x-zelyq-key-id", found.keyId)
        .header("cache-control", "no-store");
      return found.body;
    },
  );

  app.get("/v1/yanked", async (request) => {
    await installation(request);
    return { yanked: await store.yanked() };
  });

  // ------------------------------------------------------------- for us

  const secure = (request: FastifyRequest) =>
    (config.publicUrl ?? `${request.protocol}://x`).startsWith("https");

  const page = (reply: FastifyReply, title: string, body: string, status = 200) =>
    reply
      .code(status)
      .type("text/html; charset=utf-8")
      .header(
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      )
      .header("cache-control", "no-store")
      .header("referrer-policy", "same-origin")
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)} · Zelyq registry</title><style>
:root{color-scheme:light dark}body{font:14px/1.55 system-ui,sans-serif;margin:0;padding:24px;background:#f6f6f5;color:#1a1a19}
main{max-width:860px;margin:0 auto}h1{font-size:20px;margin:8px 0 16px}h2{font-size:15px;margin:22px 0 8px}
.card{background:#fff;border:1px solid #e4e4e1;border-radius:12px;padding:18px;margin-bottom:14px}
.muted{color:#6b6b65;font-size:13px}.err{color:#c2372c}.ok{color:#10893e}
input,select{font:inherit;padding:8px 10px;border:1px solid #d3d3cf;border-radius:8px;background:inherit;color:inherit}
input[type=email],input[type=password],input[type=text]{width:100%;box-sizing:border-box;margin:4px 0 10px}
button{font:600 14px system-ui;padding:8px 14px;border:0;border-radius:8px;background:#1a1a19;color:#fbfbfa;cursor:pointer}
button.danger{background:#c2372c}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px 8px;border-top:1px solid #e4e4e1;vertical-align:top}
header{display:flex;justify-content:space-between;align-items:center}code{font-size:12.5px}
@media (prefers-color-scheme:dark){body{background:#0e0e0e;color:#ededec}.card{background:#161616;border-color:#2a2a28}td,th{border-color:#2a2a28}input,select{border-color:#3a3a37}button{background:#ededec;color:#0e0e0e}}
</style></head><body><main>${body}</main></body></html>`);

  /** A form posted from another site is refused: the session cookie is not enough. */
  const sameOrigin = (request: FastifyRequest) => {
    const origin = request.headers.origin;
    const expected = config.publicUrl ?? `${request.protocol}://${request.host}`;
    return !origin || origin === expected;
  };

  const admin = async (request: FastifyRequest) => store.adminFor(request.cookies[SESSION]);

  const loginPage = (reply: FastifyReply, error = "", status = 200) =>
    page(
      reply,
      "Sign in",
      `<div class="card" style="max-width:380px;margin:10vh auto"><h1>Zelyq plugin registry</h1>
${error ? `<p class="err">${html(error)}</p>` : ""}
<form method="post" action="/admin/login"><label>Email<input type="email" name="email" required autocomplete="username"></label>
<label>Password<input type="password" name="password" required autocomplete="current-password"></label><button type="submit">Sign in</button></form></div>`,
      status,
    );

  app.get("/admin", async (request, reply) => {
    const who = await admin(request);
    if (!who) return loginPage(reply);
    const plugins = await store.adminOverview();
    const query = request.query as { done?: string; error?: string };
    const rows = plugins
      .map(
        (
          plugin,
        ) => `<div class="card"><strong>${html(plugin.name)}</strong> <code>${html(plugin.id)}</code>
<div class="muted">${html(plugin.description)} · ${html(plugin.category)}</div>
<table><tr><th>Version</th><th>Published</th><th>Installs</th><th></th></tr>${plugin.versions
          .map(
            (v) =>
              `<tr><td>${html(v.version)}</td><td>${html(v.publishedAt.slice(0, 16).replace("T", " "))}</td><td>${v.installs}</td><td>${
                v.yankedReason
                  ? `<span class="err">Withdrawn: ${html(v.yankedReason)}</span>`
                  : `<form method="post" action="/admin/yank" style="display:flex;gap:6px"><input type="hidden" name="id" value="${html(plugin.id)}"><input type="hidden" name="version" value="${html(v.version)}"><input type="text" name="reason" placeholder="Why withdraw it" required style="margin:0"><button class="danger" type="submit">Withdraw</button></form>`
              }</td></tr>`,
          )
          .join("")}</table></div>`,
      )
      .join("");
    return page(
      reply,
      "Plugins",
      `<header><h1>Zelyq plugin registry</h1><form method="post" action="/admin/logout"><button type="submit">Sign out ${html(who.email)}</button></form></header>
${query.done ? `<p class="ok">${html(query.done)}</p>` : ""}${query.error ? `<p class="err">${html(query.error)}</p>` : ""}
<div class="card"><h2 style="margin-top:0">Publish a version</h2>
<p class="muted">A <code>.tar.gz</code> with <code>zelyq-plugin.yml</code>, <code>README.md</code> and <code>LICENSE</code> at its top (and <code>CHANGELOG.md</code> from the second version). The id must start with <code>zelyq/</code>. It is checked exactly as Zelyq checks it, then signed.</p>
<form method="post" action="/admin/publish" enctype="multipart/form-data"><input type="file" name="package" accept=".tar.gz,.tgz,application/gzip" required> <button type="submit">Publish</button></form></div>
<p class="muted">${await store.installationCount()} Zelyq installations have registered. Signing key <code>${html(signer.keyId)}</code>.</p>
${rows || '<p class="muted">Nothing published yet.</p>'}`,
    );
  });

  const back = (reply: FastifyReply, key: "done" | "error", message: string) =>
    reply.redirect(`/admin?${key}=${encodeURIComponent(message)}`, 303);

  app.post(
    "/admin/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!sameOrigin(request)) return loginPage(reply, "Sign in from this page.", 403);
      const body = (request.body ?? {}) as { email?: string; password?: string };
      const token = await store.signIn(String(body.email ?? ""), String(body.password ?? ""));
      if (!token) return loginPage(reply, "That email and password do not match.", 401);
      reply.setCookie(SESSION, token, {
        path: "/admin",
        httpOnly: true,
        sameSite: "strict",
        secure: secure(request),
        maxAge: 12 * 3600,
      });
      return reply.redirect("/admin", 303);
    },
  );

  app.post("/admin/logout", async (request, reply) => {
    await store.signOut(request.cookies[SESSION]);
    reply.clearCookie(SESSION, { path: "/admin" });
    return reply.redirect("/admin", 303);
  });

  app.post("/admin/publish", async (request, reply) => {
    const who = await admin(request);
    if (!who || !sameOrigin(request)) return loginPage(reply, "Sign in again.", 401);
    const file = await request.file();
    if (!file) return back(reply, "error", "Choose a package to publish.");
    let body: Buffer;
    try {
      body = await file.toBuffer();
    } catch {
      return back(reply, "error", "That file is larger than 10 MB.");
    }
    try {
      const published = await store.publish(body, who.email);
      return back(reply, "done", `Published ${published.id} ${published.version}.`);
    } catch (error) {
      if (!(error instanceof RegistryError)) throw error;
      return back(reply, "error", error.message);
    }
  });

  app.post("/admin/yank", async (request, reply) => {
    const who = await admin(request);
    if (!who || !sameOrigin(request)) return loginPage(reply, "Sign in again.", 401);
    const body = (request.body ?? {}) as { id?: string; version?: string; reason?: string };
    try {
      await store.yank(
        String(body.id ?? ""),
        String(body.version ?? ""),
        String(body.reason ?? ""),
        who.email,
      );
      return back(reply, "done", `Withdrew ${body.id} ${body.version}.`);
    } catch (error) {
      if (!(error instanceof RegistryError)) throw error;
      return back(reply, "error", error.message);
    }
  });

  // Login and withdraw are ordinary form posts.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 16 * 1024 },
    (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );

  return {
    app,
    store,
    signer,
    close: async () => {
      await app.close();
      db.close();
    },
  };
}
