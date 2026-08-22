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
} catch (error) {
  server.app.log.error(error);
  process.exit(1);
}
