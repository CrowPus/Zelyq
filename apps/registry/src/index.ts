import { loadEnvFile } from "@zelyq/core/node";
import { buildRegistry } from "./app.js";
import { loadRegistryConfig } from "./config.js";

loadEnvFile();
const config = loadRegistryConfig();
const registry = await buildRegistry(config);
await registry.app.listen({ host: config.host, port: config.port });
registry.app.log.info(`Plugin registry signing key ${registry.signer.keyId}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void registry.close().then(() => process.exit(0));
  });
}
