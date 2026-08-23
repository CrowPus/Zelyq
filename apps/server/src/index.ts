import { loadEnvFile } from "@zelyq/core/node";
import { runMigrations } from "@zelyq/db";
import { buildServer } from "./app.js";
import { loadServerConfig } from "./config.js";

// Before anything reads process.env.
const envFile = loadEnvFile();

const config = loadServerConfig();

// Migrating on boot means a fresh clone works with one command, and a deploy
// cannot start against a schema it does not understand.
await runMigrations(config.databaseUrl);

const server = await buildServer(config);

async function shutdown(signal: string): Promise<void> {
  server.app.log.info(`${signal} received, shutting down`);
  await server.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await server.app.listen({ host: config.host, port: config.port });
  if (envFile) server.app.log.info(`loaded ${envFile}`);
  server.app.log.info(
    `zelyq server ready — runtime=${config.runtime.kind} db=${server.store.dialect} agent=${config.agentUrl}`,
  );

  // The combination that gets people hurt: reachable from off the machine while
  // the agent runs shell commands as this user. SECURITY.md says local mode is
  // not a sandbox; nothing said it out loud at the moment it mattered.
  const exposed = config.host !== "127.0.0.1" && config.host !== "localhost";
  if (exposed && config.runtime.kind === "local") {
    server.app.log.warn(
      `SECURITY: bound to ${config.host} with ZELYQ_RUNTIME=local. Agent commands run as this ` +
        "user with no sandbox, so anyone who can reach this port can run code on this machine. " +
        "Bind to 127.0.0.1, or deploy a runtime host and set ZELYQ_RUNTIME=remote. " +
        "See SECURITY.md.",
    );
    if (await server.registrationOpen()) {
      server.app.log.warn(
        "SECURITY: registration is open on an exposed instance — anyone who finds this port can " +
          "create an account. Set ZELYQ_ALLOW_REGISTRATION=false, or close it in Settings.",
      );
    }
  }
} catch (error) {
  server.app.log.error(error);
  process.exit(1);
}
