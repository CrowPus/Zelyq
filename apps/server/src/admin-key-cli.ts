import { ALL_ADMIN_SCOPES } from "@zelyq/core";
import { loadEnvFile } from "@zelyq/core/node";
import { createStore, runMigrations } from "@zelyq/db";
import { loadServerConfig } from "./config.js";
import { AdminKeyService } from "./services/admin-keys.js";

const HELP = `Admin API keys, on the server itself (for a new server with no one signed in yet).

  admin-key create --name <name> --scopes <a,b,…|all>
        Make a key. It is printed once: store it as a secret right away.
  admin-key list
        The keys, never the keys themselves.
  admin-key revoke <id>
        The key stops working at once.

Scopes: ${ALL_ADMIN_SCOPES.join(", ")}

Uses this server's own settings (.env, DATABASE_URL). Once the server runs,
the same is in Server settings → API keys.`;

export async function adminKeyCommand(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flag = (name: string) => {
    const index = rest.indexOf(name);
    return index === -1 ? undefined : rest[index + 1];
  };
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return command ? 0 : 2;
  }

  loadEnvFile();
  const config = loadServerConfig();
  await runMigrations(config.databaseUrl);
  const store = createStore(config.databaseUrl);
  const keys = new AdminKeyService(store);
  try {
    if (command === "create") {
      const scopesFlag = flag("--scopes") ?? "";
      const scopes =
        scopesFlag === "all"
          ? [...ALL_ADMIN_SCOPES]
          : scopesFlag
              .split(",")
              .map((scope) => scope.trim())
              .filter(Boolean);
      const created = await keys.create(null, { name: flag("--name") ?? "", scopes });
      console.error(
        `Made "${created.summary.name}" (${created.summary.id}) with: ${created.summary.scopes.join(", ")}.`,
      );
      console.error("The key is shown this once. Store it as a secret now:");
      console.log(created.key);
      return 0;
    }
    if (command === "list") {
      for (const key of await keys.list()) {
        console.log(
          [
            key.id,
            JSON.stringify(key.name),
            `${key.prefix}…`,
            key.scopes.join(","),
            key.revokedAt ? `revoked ${key.revokedAt}` : `last used ${key.lastUsedAt ?? "never"}`,
          ].join("  "),
        );
      }
      return 0;
    }
    if (command === "revoke") {
      const id = rest[0];
      if (!id) throw new Error("Which key? admin-key revoke <id> (see admin-key list)");
      const key = await keys.revoke(null, id);
      console.log(`Revoked "${key.name}" (${key.id}).`);
      return 0;
    }
    console.error(HELP);
    return 2;
  } finally {
    await store.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  adminKeyCommand(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      const issues = (error as { issues?: Array<{ path: unknown[]; message: string }> }).issues;
      console.error(
        issues
          ? issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("\n")
          : (error as Error).message,
      );
      process.exit(1);
    },
  );
}
