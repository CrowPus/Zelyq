import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { loadEnvFile } from "@zelyq/core/node";
import { loadRegistryConfig } from "./config.js";
import { openRegistryDb } from "./db.js";
import { loadSigner } from "./signing.js";
import { RegistryStore } from "./store.js";

/**
 * What is done on the server itself rather than in the admin page: creating
 * an admin, showing the public key Zelyq must carry, and publishing plugin
 * folders (or packages) straight from disk, under the same rules as the page.
 *
 *   pnpm --filter @zelyq/registry admin add you@example.com   (asks for the password; again resets it)
 *   pnpm --filter @zelyq/registry admin key
 *   pnpm --filter @zelyq/registry admin publish plugins/*
 */
loadEnvFile();
const config = loadRegistryConfig();
const db = await openRegistryDb(config.dataDir);
const signer = loadSigner(config.dataDir);
const store = new RegistryStore(db, signer, config.dataDir);
/** Reads a line from the terminal without showing what is typed. */
async function askHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const write = (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput;
  (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = (text) => {
    if (text.startsWith(question)) write.call(rl, question);
  };
  const answer = await rl.question(question);
  rl.close();
  process.stdout.write("\n");
  return answer;
}

const [command, email, ...rest] = process.argv.slice(2);

if (command === "add" && email) {
  const password = process.env.REGISTRY_ADMIN_PASSWORD ?? (await askHidden("Password: "));
  const outcome = await store.addAdmin(email, password);
  console.log(
    outcome === "added"
      ? `Admin ${email} added.`
      : `New password set for ${email}; signed out everywhere.`,
  );
} else if (command === "key") {
  console.log(JSON.stringify({ id: signer.keyId, publicKey: signer.publicKey }));
} else if (command === "publish" && email) {
  for (const target of [email, ...rest].map((p) => path.resolve(process.env.INIT_CWD ?? ".", p))) {
    let body: Buffer;
    if (statSync(target).isDirectory()) {
      const work = mkdtempSync(path.join(tmpdir(), "zelyq-publish-"));
      execFileSync("tar", ["-czf", path.join(work, "p.tar.gz"), "-C", target, "."]);
      body = readFileSync(path.join(work, "p.tar.gz"));
      rmSync(work, { recursive: true, force: true });
    } else {
      body = readFileSync(target);
    }
    try {
      const published = await store.publish(body, "cli");
      console.log(`Published ${published.id}@${published.version}.`);
    } catch (error) {
      console.error(`${path.basename(target)}: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  }
} else {
  console.log("Usage: admin add <email> | admin key | admin publish <folder or .tar.gz>…");
  process.exitCode = 1;
}
db.close();
