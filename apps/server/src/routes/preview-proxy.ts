import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import replyFrom from "@fastify/reply-from";
import type { FastifyInstance } from "fastify";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import type { PreviewIdle } from "../services/preview-idle.js";
import type { PreviewRouter } from "../services/preview-router.js";

/**
 * Serves previews on their own hostnames, in front of every other route.
 *
 * A request for `shop-a1b2c3.example.com` is not a request for Zelyq: it is a
 * request for that project's dev server, which is listening on loopback on a
 * port only Zelyq knows. So the match happens on the hostname, before routing,
 * and the request is forwarded verbatim.
 *
 * Three details are what make this work with real dev servers rather than in
 * principle:
 *
 * - **The upstream Host header is the loopback address, not the public one.**
 *   Vite, Next and CRA all refuse a request whose `Host` they do not
 *   recognise (`server.allowedHosts`), and the refusal looks like a Zelyq
 *   bug. The real hostname travels on `X-Forwarded-Host`, as a proxy should.
 * - **The live-reload WebSocket is proxied too.** Without it the page loads
 *   and then never updates, which is worse than not working at all, because
 *   it looks like the agent stopped doing anything.
 * - **A preview that is not running gets a page, not a dead socket.** On a
 *   shared instance a preview stops when nobody is watching it, so "start it
 *   again from the project" is the most common thing a visitor needs to be
 *   told.
 */
export async function registerPreviewProxy(
  app: FastifyInstance,
  deps: {
    router: PreviewRouter;
    /** Unused previews stop and wake on a visit (preview-idle.ts); absent: neither. */
    idle?: Pick<PreviewIdle, "seen" | "wake" | "wakeInProgress">;
  },
): Promise<void> {
  // Registered even with no preview domain yet: it can be set later from the
  // admin portal, and until then no host matches and every request passes by.
  await app.register(replyFrom, { undici: { connections: 64, pipelining: 1 } });

  app.addHook("onRequest", async (request, reply) => {
    if (!deps.router.isPreviewHost(request.hostname)) {
      // Under the preview domain but not a preview name: never the app.
      if (deps.router.isUnderPreviewDomain(request.hostname)) {
        return reply.status(404).type("text/html").send(notRunningPage());
      }
      return;
    }

    const target = await deps.router.resolve(request.hostname);
    if (!target) {
      // A preview stopped for being unused starts again when someone opens
      // it — a page load, never a dev server's own reconnect ping.
      if (deps.idle && isPageVisit(request.headers)) {
        const project = await deps.router.projectFor(request.hostname);
        const woken = project ? await deps.idle.wake(project.id) : "no";
        if (woken === "starting") {
          deps.router.forget(request.hostname);
          return reply.status(503).header("retry-after", "3").type("text/html").send(wakingPage());
        }
      }
      return reply.status(404).type("text/html").send(notRunningPage());
    }
    if (!isReconnectPing(request.headers)) deps.idle?.seen(target.project.id);
    // Waking: its record is written before its dev server listens, so until
    // the start is done a person keeps the page that reloads itself.
    const waking = Boolean(deps.idle?.wakeInProgress(target.project.id));
    if (waking && isPageVisit(request.headers)) {
      return reply.status(503).header("retry-after", "3").type("text/html").send(wakingPage());
    }

    return reply.from(`http://127.0.0.1:${target.port}${request.url}`, {
      rewriteRequestHeaders: (original, headers) => ({
        ...headers,
        host: `127.0.0.1:${target.port}`,
        "x-forwarded-host": original.headers.host ?? "",
        "x-forwarded-proto": original.protocol,
      }),
      // A dev server compiling on demand can take a while on the first
      // request of a cold project.
      retriesCount: 0,
      // The record said "port 4380", and nothing answers there: the dev
      // server has gone — stopped, crashed, or taken down with a restart.
      // A visitor should read that, not a connection error.
      onError: (errorReply, { error }) => {
        deps.router.forget(request.hostname);
        // undici reports the socket failure on the cause as often as on the
        // error itself, so both are read, and the message as a last resort.
        const failure = error as { code?: string; cause?: { code?: string }; message?: string };
        const code = failure.code ?? failure.cause?.code ?? "";
        const gone =
          code === "ECONNREFUSED" ||
          code === "ECONNRESET" ||
          /ECONNREFUSED|ECONNRESET/.test(failure.message ?? "");
        if (gone) {
          if (deps.idle?.wakeInProgress(target.project.id) && isPageVisit(request.headers)) {
            void errorReply
              .status(503)
              .header("retry-after", "3")
              .type("text/html")
              .send(wakingPage());
            return;
          }
          void errorReply.status(404).type("text/html").send(notRunningPage());
          return;
        }
        void errorReply.send(error);
      },
    });
  });

  /**
   * WebSocket upgrades never reach a route handler, so they are taken off the
   * server's own upgrade event.
   *
   * The handler *replaces* the ones already attached rather than joining
   * them: Node hands an upgrade to every listener, so `@fastify/websocket`
   * would also try to answer a preview's live-reload connection, and two
   * handshakes on one socket corrupt the stream — it surfaces as "RSV1 must
   * be clear" on the first frame, which reads like a compression bug and is
   * not one. Anything that is not a preview is passed straight to the
   * listeners that were already there.
   *
   * Done on `onReady`, once every plugin has registered its own.
   */
  app.addHook("onReady", async () => {
    const existing = app.server.listeners("upgrade") as Array<
      (request: IncomingMessage, socket: Duplex, head: Buffer) => void
    >;
    app.server.removeAllListeners("upgrade");

    app.server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const hostname = request.headers.host?.split(":")[0];
      if (!deps.router.isPreviewHost(hostname)) {
        if (deps.router.isUnderPreviewDomain(hostname)) {
          socket.destroy();
          return;
        }
        for (const listener of existing) listener.call(app.server, request, socket, head);
        return;
      }

      void (async () => {
        const target = hostname ? await deps.router.resolve(hostname) : null;
        if (!target) {
          socket.destroy();
          return;
        }
        deps.idle?.seen(target.project.id);
        proxyWebSocket(request, socket, head, target.port);
      })();
    });
  });
}

/**
 * Pipes one websocket to another, both ways.
 *
 * The subprotocol is the detail that matters. Vite's live-reload client asks
 * for `vite-hmr`, and Vite's server only completes the handshake when it is
 * asked for. Offered to the upstream as a real subprotocol — not smuggled in
 * as a header, which the socket library ignores and then rejects the
 * server's answer to ("Server sent a subprotocol but none was requested").
 * That one mistake closed every live-reload socket the instant it opened;
 * Vite took the closed socket for a dead server, polled, found the page
 * fine, and reloaded — 159 times in fifteen seconds, measured.
 *
 * The visitor's handshake is completed only once the upstream one has, so
 * the protocol echoed back is the one the dev server actually chose, and
 * anything the dev server says in the meantime (Vite announces itself
 * immediately) is held and delivered rather than lost.
 */
function proxyWebSocket(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  port: number,
): void {
  const offered = String(request.headers["sec-websocket-protocol"] ?? "")
    .split(",")
    .map((protocol) => protocol.trim())
    .filter(Boolean);

  const upstream = new WebSocket(`ws://127.0.0.1:${port}${request.url ?? "/"}`, offered, {
    // Same Host rule as for HTTP: the dev server checks it on the socket too.
    headers: { host: `127.0.0.1:${port}` },
  });

  const held: RawData[] = [];
  let client: WebSocket | null = null;
  upstream.on("message", (data: RawData) => {
    if (client && client.readyState === WebSocket.OPEN) client.send(data);
    else held.push(data);
  });

  upstream.once("error", () => socket.destroy());
  upstream.once("open", () => {
    const server = new WebSocketServer({
      noServer: true,
      handleProtocols: () => upstream.protocol || false,
    });
    // The real `head`, not an empty buffer: a client that sends its first
    // frame in the same packet as the upgrade has those bytes here.
    server.handleUpgrade(request, socket, head, (accepted: WebSocket) => {
      client = accepted;
      for (const data of held.splice(0)) accepted.send(data);
      const close = () => {
        accepted.close();
        upstream.close();
      };
      accepted.on(
        "message",
        (data: RawData) => upstream.readyState === WebSocket.OPEN && upstream.send(data),
      );
      accepted.on("close", close);
      upstream.on("close", close);
      accepted.on("error", close);
      upstream.on("error", close);
    });
  });
}

/** What a visitor sees when the preview behind an address is not running. */
/** A person opening the page, not a script asking for something in it. */
function isPageVisit(headers: Record<string, string | string[] | undefined>): boolean {
  const mode = headers["sec-fetch-mode"];
  if (typeof mode === "string") return mode === "navigate";
  return String(headers.accept ?? "").includes("text/html");
}

/** What Vite's client sends, over and over, while its server is gone. */
function isReconnectPing(headers: Record<string, string | string[] | undefined>): boolean {
  return String(headers.accept ?? "").includes("text/x-vite-ping");
}

/** Shown while a preview stopped for being unused starts again; reloads itself. */
function wakingPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="3" />
    <title>Starting…</title>
    <style>
      body { font: 16px/1.6 system-ui, sans-serif; margin: 0; display: grid;
             place-items: center; min-height: 100vh; background: #0b0b0c; color: #e7e7ea; }
      div { max-width: 28rem; padding: 2rem; }
      h1 { font-size: 1.1rem; margin: 0 0 .5rem; }
      p { margin: 0; color: #a1a1aa; }
    </style>
  </head>
  <body>
    <div>
      <h1>Starting this app…</h1>
      <p>It was stopped because nobody used it for a while. This page reloads by itself
         in a few seconds.</p>
    </div>
  </body>
</html>`;
}

function notRunningPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Preview not running</title>
    <style>
      body { font: 16px/1.6 system-ui, sans-serif; margin: 0; display: grid;
             place-items: center; min-height: 100vh; background: #0b0b0c; color: #e7e7ea; }
      div { max-width: 28rem; padding: 2rem; }
      h1 { font-size: 1.1rem; margin: 0 0 .5rem; }
      p { margin: 0; color: #a1a1aa; }
    </style>
  </head>
  <body>
    <div>
      <h1>This preview is not running</h1>
      <p>Open the project in Zelyq and start its preview again. Previews stop
         on their own when nobody is watching them, and start in a few seconds.</p>
    </div>
  </body>
</html>`;
}
