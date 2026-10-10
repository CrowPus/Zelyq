import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";

/**
 * The command, run as a person runs it, against a stand-in for Vault's
 * outside API that behaves like the real one: Bearer key, names, batch reads,
 * and refusals with a reason.
 */

const KEY = "zvk_test0000_fake";
const SECRETS: Record<string, string> = {
  STRIPE_KEY_LIVE: "sk_live_cli",
  DB_PASSWORD: "hunter2",
  "gcp.json": "{}",
};
let server: http.Server;
let url = "";
const seen: string[] = [];

before(async () => {
  server = http.createServer((req, res) => {
    seen.push(req.url ?? "");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${KEY}`) {
      return send(401, {
        error: { code: "unauthorized", message: "That service key is not valid." },
      });
    }
    const parsed = new URL(req.url ?? "/", "http://x");
    if (parsed.pathname === "/api/v1/vault/secrets") {
      const names = parsed.searchParams.get("names");
      if (names === null)
        return send(200, { secrets: Object.keys(SECRETS).map((name) => ({ name })) });
      const asked = names.split(",");
      return send(200, {
        secrets: asked.filter((n) => n in SECRETS).map((name) => ({ name, value: SECRETS[name] })),
        missing: asked.filter((n) => !(n in SECRETS)),
      });
    }
    const one = /^\/api\/v1\/vault\/secrets\/(.+)$/.exec(parsed.pathname);
    if (one) {
      const name = decodeURIComponent(one[1] ?? "");
      return name in SECRETS
        ? send(200, { name, value: SECRETS[name] })
        : send(404, { error: { code: "not_found", message: `${name} is not in this Vault.` } });
    }
    send(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const entry = path.resolve(import.meta.dirname, "..", "src", "index.ts");

function zelyq(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", entry, ...args], {
      env: { PATH: process.env.PATH ?? "", ZELYQ_URL: url, ZELYQ_VAULT_KEY: KEY, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("exit", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

const printEnv = (names: string[]) => [
  process.execPath,
  "-e",
  `process.stdout.write(JSON.stringify({${names.map((n) => `${n}: process.env.${n}`).join(",")}}))`,
];

test("run starts the program with every secret in its environment — and not the key", async () => {
  const result = await zelyq([
    "vault",
    "run",
    "--",
    ...printEnv(["STRIPE_KEY_LIVE", "DB_PASSWORD", "ZELYQ_VAULT_KEY"]),
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    STRIPE_KEY_LIVE: "sk_live_cli",
    DB_PASSWORD: "hunter2",
  });
  // A Vault name that cannot be a variable is skipped, and says so.
  assert.match(result.stderr, /skipping gcp\.json/);
});

test("--only gives just those, without needing to list", async () => {
  seen.length = 0;
  const result = await zelyq([
    "vault",
    "run",
    "--only",
    "DB_PASSWORD",
    "--",
    ...printEnv(["DB_PASSWORD", "STRIPE_KEY_LIVE"]),
  ]);
  assert.deepEqual(JSON.parse(result.stdout), { DB_PASSWORD: "hunter2" });
  assert.ok(!seen.includes("/api/v1/vault/secrets"), "it did not need the list scope");
});

test("the program's exit code is the command's exit code", async () => {
  const result = await zelyq([
    "vault",
    "run",
    "--only",
    "DB_PASSWORD",
    "--",
    process.execPath,
    "-e",
    "process.exit(7)",
  ]);
  assert.equal(result.code, 7);
});

test("get prints one value; list prints names", async () => {
  assert.equal((await zelyq(["vault", "get", "STRIPE_KEY_LIVE"])).stdout, "sk_live_cli");
  assert.deepEqual((await zelyq(["vault", "list"])).stdout.trim().split("\n").sort(), [
    "DB_PASSWORD",
    "STRIPE_KEY_LIVE",
    "gcp.json",
  ]);
});

test("a refusal, a missing secret and a missing key each say what is wrong", async () => {
  const bad = await zelyq(["vault", "list"], { ZELYQ_VAULT_KEY: "zvk_wrong" });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /not valid/);

  const missing = await zelyq(["vault", "run", "--only", "NOPE", "--", "true"]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /Not in Vault: NOPE/);

  const noKey = await zelyq(["vault", "list"], { ZELYQ_VAULT_KEY: "" });
  assert.match(noKey.stderr, /ZELYQ_VAULT_KEY/);
});
