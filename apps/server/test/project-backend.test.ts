import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Store } from "@zelyq/db";
import type { RuntimeDriver } from "@zelyq/runtime";
import { ProjectBackendService } from "../src/services/project-backend.js";
import { SecretBox } from "../src/services/secrets.js";
import { listTemplates } from "../src/services/templates.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

/** The settings table, in memory — the only part of the store this service uses. */
function memoryStore(): Store {
  const rows = new Map<string, string>();
  return {
    settings: {
      async get(key: string) {
        return rows.get(key) ?? null;
      },
      async set(key: string, value: string) {
        rows.set(key, value);
      },
      async remove(key: string) {
        rows.delete(key);
      },
    },
  } as unknown as Store;
}

/** A project that declares the Python runtime, unless told otherwise. */
function runtimeWithManifest(hasManifest = true): RuntimeDriver {
  return {
    kind: "local",
    async readFile(_id: string, file: string) {
      if (file === "zelyq.runtime.json" && hasManifest) {
        return {
          path: file,
          content: JSON.stringify({
            version: 1,
            stack: "react-fastapi",
            install: [{ command: "npm ci" }],
            services: [
              { id: "backend", cwd: "backend", argv: ["uv"], healthPath: "/api/health/ready" },
              { id: "frontend", argv: ["npm"], healthPath: "/" },
            ],
            checks: [{ name: "tests", command: "pytest" }],
          }),
          encoding: "utf8",
        };
      }
      throw Object.assign(new Error("not found"), { code: "not_found" });
    },
  } as unknown as RuntimeDriver;
}

/** Names resolve through this table, never the network: a test must not
 * depend on what a public DNS name happens to point at today. */
const dnsTable: Record<string, string[]> = {
  "localtest.me": ["127.0.0.1"],
  "127.0.0.1.nip.io": ["127.0.0.1"],
  "imds.example": ["169.254.169.254"],
  "db.example.com": ["93.184.216.34"],
};
const fakeLookup = async (hostname: string) => {
  const found = dnsTable[hostname];
  if (!found) throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
  return found;
};

function service(runtime: RuntimeDriver = runtimeWithManifest()): ProjectBackendService {
  return new ProjectBackendService(
    memoryStore(),
    new SecretBox(randomBytes(32)),
    runtime,
    fakeLookup,
  );
}

test("a new project already has a database it can write to", async () => {
  // A build tool has to save data before anybody configures anything, so an
  // untouched project resolves to its own local SQLite file — not "none".
  const configuration = await service().get("p1");
  assert.equal(configuration.engine, "sqlite");
  assert.equal(configuration.ownership, "application");
  assert.equal(configuration.readOnly, false, "an app's own database is writable");
  assert.equal(configuration.configured, true);
  assert.deepEqual(configuration.secretNames, []);
});

test("the local database is handed to the API, and may migrate itself", async () => {
  const options = await service().previewOptions("p1");
  assert.equal(options.backendEnv?.DATABASE_ENGINE, "sqlite");
  assert.equal(options.backendEnv?.DATABASE_READ_ONLY, "false");
  assert.equal(options.backendEnv?.DATABASE_OWNERSHIP, "application");
  assert.equal(options.backendEnv?.DATABASE_URL, undefined, "the runtime picks the file");
  assert.equal(options.backendEnv?.ZELYQ_DB_AUTOMIGRATE, "1");
});

test("a database somebody else owns is never migrated automatically", async () => {
  const backend = service();
  const base = {
    ownership: "external" as const,
    tables: [],
    readOnly: true,
    auth: "none" as const,
    secrets: {},
  };
  await backend.save("p1", {
    ...base,
    engine: "postgresql",
    databaseUrl: "postgresql://u:p@db.example.com/app",
  });
  const external = await backend.previewOptions("p1");
  assert.equal(external.backendEnv?.ZELYQ_DB_AUTOMIGRATE, undefined);
  assert.equal(external.backendEnv?.DATABASE_READ_ONLY, "true");

  // Even SQLite loses it once it points at a file the user chose.
  await backend.save("p2", { ...base, engine: "sqlite", ownership: "application" });
  assert.equal((await backend.previewOptions("p2")).backendEnv?.ZELYQ_DB_AUTOMIGRATE, "1");
});

test("read-only follows ownership when it is not stated", async () => {
  const backend = service();
  const base = { tables: [], auth: "none" as const, secrets: {} };
  const owned = await backend.save("p1", { ...base, engine: "sqlite", ownership: "application" });
  assert.equal(owned.readOnly, false, "the app's own schema is writable");

  const theirs = await backend.save("p2", {
    ...base,
    engine: "postgresql",
    ownership: "external",
    databaseUrl: "postgresql://u:p@db.example.com/app",
  });
  assert.equal(theirs.readOnly, true, "somebody else's data is read-only until they say otherwise");
});

test("a saved connection URL is never read back, only its presence", async () => {
  const backend = service();
  const saved = await backend.save("p1", {
    engine: "postgresql",
    ownership: "external",
    tables: [],
    readOnly: true,
    auth: "none",
    databaseUrl: "postgresql://user:hunter2@db.example.com/app",
    secrets: { STRIPE_KEY: "sk_live_secret" },
  });

  assert.equal(saved.configured, true);
  assert.deepEqual(saved.secretNames, ["STRIPE_KEY"]);
  assert.equal(JSON.stringify(saved).includes("hunter2"), false, "no credential in the response");
  assert.equal(JSON.stringify(saved).includes("sk_live_secret"), false);
});

test("secrets survive a save that does not mention them, and can be cleared by name", async () => {
  const backend = service();
  const base = {
    engine: "none" as const,
    ownership: "external" as const,
    tables: [],
    readOnly: true,
    auth: "none" as const,
  };
  await backend.save("p1", { ...base, secrets: { A_KEY: "one", B_KEY: "two" } });
  const kept = await backend.save("p1", { ...base, secrets: {} });
  assert.deepEqual(kept.secretNames.sort(), ["A_KEY", "B_KEY"]);

  const cleared = await backend.save("p1", { ...base, secrets: { A_KEY: null } });
  assert.deepEqual(cleared.secretNames, ["B_KEY"]);
});

test("platform-owned variable names cannot be claimed by a project secret", async () => {
  const backend = service();
  const base = {
    engine: "none" as const,
    ownership: "external" as const,
    tables: [],
    readOnly: true,
    auth: "none" as const,
  };
  for (const name of ["DATABASE_URL", "ZELYQ_DATA_DIR", "PATH", "AUTH_ISSUER", "SUPABASE_URL"]) {
    await assert.rejects(
      () => backend.save("p1", { ...base, secrets: { [name]: "x" } }),
      new RegExp(name),
      `${name} must be refused`,
    );
  }
});

test("a connection URL has to match the engine that was chosen", async () => {
  const backend = service();
  const base = {
    ownership: "external" as const,
    tables: [],
    readOnly: true,
    auth: "none" as const,
    secrets: {},
  };
  await assert.rejects(
    () => backend.save("p1", { ...base, engine: "mysql", databaseUrl: "postgresql://h/db" }),
    /does not match the selected database engine/,
  );
  await assert.rejects(
    () => backend.save("p1", { ...base, engine: "none", databaseUrl: "postgresql://h/db" }),
    /Select a SQL engine/,
  );
  await assert.rejects(
    () => backend.save("p1", { ...base, engine: "sqlite", databaseUrl: "sqlite:////etc/passwd" }),
    /external paths are not accepted/,
  );
  await assert.rejects(
    () => backend.save("p1", { ...base, engine: "postgresql", databaseUrl: "not a url" }),
    /Invalid database URL/,
  );
});

test("the cloud metadata endpoint is not a database host", async () => {
  const backend = service();
  for (const host of ["169.254.169.254", "metadata.google.internal"]) {
    await assert.rejects(
      () =>
        backend.save("p1", {
          engine: "postgresql",
          ownership: "external",
          tables: [],
          readOnly: true,
          auth: "none",
          secrets: {},
          databaseUrl: `postgresql://user:pw@${host}/app`,
        }),
      /not permitted/,
    );
  }
});

test("identity endpoints must be HTTPS", async () => {
  await assert.rejects(
    () =>
      service().save("p1", {
        engine: "none",
        ownership: "external",
        tables: [],
        readOnly: true,
        auth: "jwt",
        issuer: "http://id.example.com",
        audience: "api",
        jwksUrl: "https://id.example.com/jwks",
        secrets: {},
      }),
    /must use HTTPS/,
  );
});

test("secrets reach the backend service only, never the browser environment", async () => {
  const backend = service();
  await backend.save("p1", {
    engine: "postgresql",
    ownership: "external",
    tables: ["orders"],
    readOnly: true,
    auth: "none",
    databaseUrl: "postgresql://user:hunter2@db.example.com/app",
    secrets: { STRIPE_KEY: "sk_live_secret" },
  });

  const options = await backend.previewOptions("p1", {
    VITE_SUPABASE_URL: "https://x.supabase.co",
  });
  assert.equal(options.backendEnv?.DATABASE_URL, "postgresql://user:hunter2@db.example.com/app");
  assert.equal(options.backendEnv?.STRIPE_KEY, "sk_live_secret");
  assert.equal(options.backendEnv?.DATABASE_TABLES, "orders");

  const browserEnv = JSON.stringify(options.env);
  assert.equal(browserEnv.includes("hunter2"), false, "no credential in the browser bundle");
  assert.equal(browserEnv.includes("sk_live_secret"), false);
  assert.equal(options.env?.VITE_SUPABASE_URL, "https://x.supabase.co");
});

test("saving changes the revision so a running preview is restarted", async () => {
  const backend = service();
  const base = {
    engine: "none" as const,
    ownership: "external" as const,
    tables: [],
    readOnly: true,
    auth: "none" as const,
    secrets: {},
  };
  const first = await backend.save("p1", base);
  const second = await backend.save("p1", base);
  assert.notEqual(first.revision, second.revision);
});

test("a project without a Python manifest gets no backend environment at all", async () => {
  const backend = service(runtimeWithManifest(false));
  const options = await backend.previewOptions("p1", {
    VITE_SUPABASE_URL: "https://x.supabase.co",
  });
  assert.equal(options.backendEnv, undefined);
  assert.equal(options.configurationRevision, undefined);
  assert.equal(options.env?.VITE_SUPABASE_URL, "https://x.supabase.co");
});

test("environments are configured separately and do not read each other", async () => {
  const backend = service();
  await backend.save(
    "p1",
    {
      engine: "postgresql",
      ownership: "external",
      tables: [],
      readOnly: true,
      auth: "none",
      databaseUrl: "postgresql://user:pw@prod.example.com/app",
      secrets: {},
    },
    "production",
  );
  // Development is untouched: still this project's own local database.
  assert.equal((await backend.get("p1", "development")).engine, "sqlite");
  assert.equal((await backend.get("p1", "production")).engine, "postgresql");

  // A preview must not be able to reach the production target.
  const options = await backend.previewOptions("p1");
  assert.equal(options.backendEnv?.DATABASE_URL, undefined);
  assert.equal(options.backendEnv?.DATABASE_ENGINE, "sqlite");
});

test("a preview capability lasts as long as its agent session", async () => {
  const backend = service();
  const first = backend.mint("session-1", "p1", "user-1");
  assert.deepEqual(backend.resolve(first), { projectId: "p1", userId: "user-1" });

  // The gateway mints on every prompt, but a reused agent session keeps the
  // token it was created with — so that token must keep working.
  const again = backend.mint("session-1", "p1", "user-1");
  assert.equal(again, first);
  assert.deepEqual(backend.resolve(first), { projectId: "p1", userId: "user-1" });

  // Anybody else in that session gets a token of their own, and the old one
  // stops working.
  const other = backend.mint("session-1", "p1", "user-2");
  assert.notEqual(other, first);
  assert.equal(backend.resolve(first), null);
  assert.deepEqual(backend.resolve(other), { projectId: "p1", userId: "user-2" });
  assert.equal(backend.resolve("made-up-token"), null);
});

// ---------------------------------------------------------------------------
// Template gating
// ---------------------------------------------------------------------------

test("a Python stack is hidden from a runtime that cannot run it", async () => {
  const templatesDir = path.join(repoRoot, "templates");
  const withPython = await listTemplates(templatesDir, ["react-fastapi-v1"]);
  const withoutPython = await listTemplates(templatesDir, []);

  assert.ok(
    withPython.some((template) => template.name === "react-fastapi"),
    "offered when the runtime advertises the capability",
  );
  assert.equal(
    withoutPython.some((template) => template.name === "react-fastapi"),
    false,
    "not offered when it would only fail at the first preview",
  );
  assert.ok(
    withoutPython.some((template) => template.name === "vite-react"),
    "stacks with no capability requirement are unaffected",
  );
});

test("omitting the capability list lists everything, as before", async () => {
  const all = await listTemplates(path.join(repoRoot, "templates"));
  assert.ok(all.some((template) => template.name === "react-fastapi"));
});

test("the scaffolded starter carries no build output or Python caches", async () => {
  const { loadTemplate } = await import("../src/services/templates.js");
  const files = await loadTemplate(path.join(repoRoot, "templates"), "react-fastapi", {
    projectName: "Demo",
    projectSlug: "demo",
    projectId: "p1",
  });
  const junk = files.filter((file) =>
    /(^|\/)(dist|node_modules|\.venv|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.zelyq)\//.test(
      file.path,
    ),
  );
  assert.deepEqual(junk, [], "a new project starts from source, not a previous build");
  assert.ok(files.some((file) => file.path === "zelyq.runtime.json"));
  assert.ok(files.some((file) => file.path === "backend/uv.lock"));
  assert.ok(
    files.some((file) => file.path === ".gitignore"),
    "_gitignore ships as .gitignore",
  );

  // A starter must never carry a real credential file.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-template-"));
  await fs.rm(tmp, { recursive: true, force: true });
  assert.equal(
    files.some((file) => /(^|\/)\.env$/.test(file.path)),
    false,
  );
});

test("a database host that only ever means this machine is refused", async () => {
  const backend = service();
  const base = {
    engine: "postgresql" as const,
    ownership: "external" as const,
    tables: [],
    readOnly: true,
    auth: "none" as const,
    secrets: {},
  };
  // The connection test runs on the Zelyq host's network, so these are
  // requests to the platform itself, not to a user's database.
  const refused = [
    "127.0.0.1",
    "127.1",
    "localhost",
    "[::1]",
    "0.0.0.0",
    "169.254.169.254",
    "[fd00:ec2::254]",
    "metadata.google.internal",
    "2852039166", // 169.254.169.254 written as an integer
    "0xa9fea9fe", // and as hex
    "0x7f.1", // inet_aton shorthand a resolver still sends to loopback
    "017700000001", // the same, in octal
    "2130706433", // 127.0.0.1 as an integer
    "[::ffff:127.0.0.1]", // IPv4-mapped; URL rewrites this to ::ffff:7f00:1
    "[::ffff:169.254.169.254]",
    "app.localhost",
    "localhost.", // the fully-qualified spelling of the same name
    "[::127.0.0.1]", // IPv4-compatible; URL rewrites this to ::7f00:1
    "localtest.me", // public DNS names that resolve to loopback
    "127.0.0.1.nip.io",
    "imds.example", // and one that resolves to the metadata service
  ];
  for (const host of refused) {
    await assert.rejects(
      () => backend.save("p1", { ...base, databaseUrl: `postgresql://u:p@${host}/app` }),
      /not permitted/,
      `${host} must be refused`,
    );
  }

  // The driver connects to a host given in the query string instead of the
  // URL's own — found in review, every one of these reached this machine.
  const overridden = [
    "postgresql://u:p@db.example.com/app?host=127.0.0.1",
    "postgresql://u:p@db.example.com/app?hostaddr=169.254.169.254",
    "postgresql://u:p@db.example.com/app?host=/var/run/postgresql",
    "postgresql://u:p@db.example.com/app?host=db.example.com,localhost",
    "postgresql://u:p@db.example.com/app?HOST=localtest.me",
    // libpq tries each host of a comma-separated list in the URL itself.
    "postgresql://u:p@db.example.com,127.0.0.1:5432/app",
    // Connection settings read from a file on the runtime's machine.
    "postgresql://u:p@db.example.com/app?service=local",
    "postgresql://u:p@db.example.com/app?read_default_file=/etc/mysql/my.cnf",
  ];
  for (const databaseUrl of overridden) {
    await assert.rejects(
      () => backend.save("p1", { ...base, databaseUrl }),
      /not permitted/,
      `${databaseUrl} must be refused`,
    );
  }
  await assert.rejects(
    () =>
      backend.save("p1", {
        ...base,
        engine: "mysql",
        databaseUrl: "mysql://u:p@db.example.com/app?unix_socket=/tmp/mysql.sock",
      }),
    /not permitted/,
  );
});

test("an ordinary or privately-hosted database host is still accepted", async () => {
  const backend = service();
  const base = {
    engine: "postgresql" as const,
    ownership: "external" as const,
    tables: [],
    readOnly: true,
    auth: "none" as const,
    secrets: {},
  };
  // A self-hosted database on a private network is the normal case; limiting
  // that is the operator's network policy, not a string check.
  for (const host of ["db.example.com", "10.1.2.3", "192.168.1.50", "customer-db.internal"]) {
    assert.ok(
      await backend.save("p1", { ...base, databaseUrl: `postgresql://u:p@${host}/app` }),
      `${host} should be allowed`,
    );
  }
  // Ordinary connection options, and a second host that is itself fine.
  for (const query of ["sslmode=require", "host=10.1.2.3", "connect_timeout=5"]) {
    assert.ok(
      await backend.save("p1", {
        ...base,
        databaseUrl: `postgresql://u:p@db.example.com/app?${query}`,
      }),
      `?${query} should be allowed`,
    );
  }
});
