import { loadEnvFile } from "@zelyq/core/node";
import { buildHost } from "./app.js";
import { loadHostConfig } from "./config.js";

// Before anything reads process.env.
const envFile = loadEnvFile();

const config = loadHostConfig();
const host = buildHost(config);

async function shutdown(signal: string): Promise<void> {
  host.app.log.info(`${signal} received, shutting down`);
  await host.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await host.app.listen({ host: config.host, port: config.port });
  if (envFile) host.app.log.info(`loaded ${envFile}`);
  host.app.log.info(`zelyq runtime host ready — workspace ${config.runtime.workspaceDir}`);
  if (!config.token) {
    host.app.log.warn(
      "ZELYQ_RUNTIME_TOKEN is not set, so every caller is trusted. Set one before binding " +
        "anywhere but loopback.",
    );
  }
  // Said plainly, because the protocol document promises isolation and this
  // implementation does not provide any.
  host.app.log.warn(
    "This reference host executes with the local driver and applies NO isolation: no container, " +
      "no resource limits, no egress control. Run it inside a container per project before " +
      "pointing it at anything you care about. See docs/runtime-protocol.md.",
  );
} catch (error) {
  host.app.log.error(error);
  process.exit(1);
}
