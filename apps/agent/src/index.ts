import { loadEnvFile } from "@zelyq/core/node";
import { ALL_TOOLS } from "@zelyq/tools";
import { loadAgentConfig } from "./config.js";
import { loadPlugins } from "./plugins.js";
import { PROVIDERS } from "./providers/index.js";
import { buildAgentServer } from "./server.js";

// Before anything reads process.env.
const envFile = loadEnvFile();

const config = await loadAgentConfig();
// Boot-time only, before the server exists to accept a prompt — see `037`
// in the council notes. `ALL_TOOLS` is the same array every session's tool
// list already defaults to, so appending to it here is enough; nothing
// downstream needs to know a tool came from a plugin rather than the box.
// Loaded before `buildAgentServer` so `/health` can report the names back
// without the agent's own boot log being the only place to see them.
const plugins = await loadPlugins(process.env.ZELYQ_PLUGIN_DIR, ALL_TOOLS);

const server = buildAgentServer(config, { pluginNames: plugins.loaded });
if (plugins.loaded.length > 0) {
  server.app.log.info(
    `${plugins.loaded.length} plugin tool(s) loaded: ${plugins.loaded.join(", ")}`,
  );
}

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
    `zelyq agent ready — runtime=${config.runtime.kind} provider=${config.provider} model=${config.model} effort=${config.effort}`,
  );
  if (!config.apiKey) {
    const info = PROVIDERS[config.provider];
    server.app.log.warn(
      `${info.apiKeyEnv.join(" / ")} is not set, so ${info.label} prompts will fail. ` +
        `Put a key in .env (${info.docsUrl}) and restart.`,
    );
  }
} catch (error) {
  server.app.log.error(error);
  process.exit(1);
}
