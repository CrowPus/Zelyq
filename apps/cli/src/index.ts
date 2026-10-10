#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { asEnvironmentName, VaultClient, VaultError } from "./vault.js";

const HELP = `zelyq vault — use secrets from Zelyq Vault without writing them anywhere.

Usage:
  zelyq vault run [--only A,B] -- <command> [args…]
        Start <command> with Vault secrets in its environment.
        Without --only, every secret the key may list is given.
  zelyq vault get <NAME>      Print one value (for scripts).
  zelyq vault list            Print the names this key may see.

Configuration (environment, or flags):
  ZELYQ_URL         --url     Where Zelyq is, e.g. https://app.zelyq.com
  ZELYQ_VAULT_KEY             A Vault service key (zvk_…), made in Vault → Service keys

The key is read from the environment only, never from a flag, so it does not
end up in shell history or a process listing.`;

async function main(argv: string[]): Promise<number> {
  const [group, command, ...rest] = argv;
  if (group !== "vault" || !command || command === "--help" || command === "-h") {
    console.log(HELP);
    return group === "vault" || group === undefined || group === "--help" ? 0 : 2;
  }

  const separator = rest.indexOf("--");
  const own = separator === -1 ? rest : rest.slice(0, separator);
  const child = separator === -1 ? [] : rest.slice(separator + 1);
  const flag = (name: string) => {
    const index = own.indexOf(name);
    return index === -1 ? undefined : own[index + 1];
  };

  const client = new VaultClient({
    url: flag("--url") ?? process.env.ZELYQ_URL ?? "",
    key: process.env.ZELYQ_VAULT_KEY ?? "",
  });

  if (command === "list") {
    for (const name of await client.names()) console.log(name);
    return 0;
  }
  if (command === "get") {
    const name = own.find((arg) => !arg.startsWith("--") && arg !== flag("--url"));
    if (!name) throw new VaultError("Which secret? zelyq vault get <NAME>");
    process.stdout.write(await client.value(name));
    return 0;
  }
  if (command === "run") {
    if (child.length === 0)
      throw new VaultError("Give a command after --: zelyq vault run -- node server.js");
    const only = flag("--only")
      ?.split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    const names = only ?? (await client.names());
    const values = await client.values(names);
    const env: NodeJS.ProcessEnv = { ...process.env };
    // The key that fetched them is not something the program needs.
    delete env.ZELYQ_VAULT_KEY;
    for (const [name, value] of Object.entries(values)) {
      const variable = asEnvironmentName(name);
      if (!variable) {
        console.error(`zelyq: skipping ${name}: not a valid environment variable name`);
        continue;
      }
      env[variable] = value;
    }
    return await run(child, env);
  }
  console.log(HELP);
  return 2;
}

/** Runs the program in this terminal, passes signals on, and exits as it did. */
function run(command: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const [file, ...args] = command as [string, ...string[]];
    const program = spawn(file, args, { env, stdio: "inherit" });
    const forward = (signal: NodeJS.Signals) => program.kill(signal);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, forward);
    program.on("error", (error) => {
      console.error(`zelyq: could not start ${file}: ${error.message}`);
      resolve(127);
    });
    // Killed by a signal: exit the way a shell reports it, 128 + its number.
    program.on("exit", (code, signal) =>
      resolve(code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1)),
    );
  });
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(`zelyq: ${error instanceof VaultError ? error.message : String(error)}`);
    process.exit(1);
  },
);
