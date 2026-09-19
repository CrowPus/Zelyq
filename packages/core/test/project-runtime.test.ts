import assert from "node:assert/strict";
import { test } from "node:test";
import { backendConfigurationSchema, projectRuntimeSchema } from "../src/project-runtime.js";

/**
 * `zelyq.runtime.json` is authored inside a project, so the agent — or anyone
 * who can edit a file — decides what it says. It is parsed as untrusted input.
 */
const manifest = {
  version: 1,
  stack: "react-fastapi",
  install: [{ command: "npm ci" }, { command: "uv sync --locked", cwd: "backend" }],
  services: [
    {
      id: "backend",
      cwd: "backend",
      argv: ["uv", "run", "uvicorn"],
      healthPath: "/api/health/ready",
    },
    { id: "frontend", argv: ["npm", "run", "dev"], healthPath: "/" },
  ],
  checks: [{ name: "Python tests", command: "uv run pytest", cwd: "backend" }],
};

test("accepts the starter manifest and fills defaults", () => {
  const parsed = projectRuntimeSchema.parse(manifest);
  assert.equal(parsed.install[0]?.cwd, ".");
  assert.equal(parsed.install[0]?.timeoutMs, 120_000);
  assert.equal(parsed.services[1]?.cwd, ".");
});

test("rejects a working directory that escapes the project", () => {
  for (const cwd of ["../../etc", "/etc", "backend/../../..", "c:/windows", "back\\end"]) {
    assert.throws(
      () => projectRuntimeSchema.parse({ ...manifest, install: [{ command: "x", cwd }] }),
      `expected ${cwd} to be refused`,
    );
  }
});

test("a service cwd is validated the same way as an install step", () => {
  assert.throws(() =>
    projectRuntimeSchema.parse({
      ...manifest,
      services: [{ ...manifest.services[0], cwd: "../../.ssh" }, manifest.services[1]],
    }),
  );
});

test("backend must be declared before frontend so the proxy target exists", () => {
  assert.throws(
    () =>
      projectRuntimeSchema.parse({
        ...manifest,
        services: [manifest.services[1], manifest.services[0]],
      }),
    /Declare backend then frontend/,
  );
});

test("rejects an unknown schema version rather than guessing", () => {
  assert.throws(() => projectRuntimeSchema.parse({ ...manifest, version: 2 }));
  assert.throws(() => projectRuntimeSchema.parse({ ...manifest, stack: "django" }));
});

test("unknown keys are refused, not silently ignored", () => {
  assert.throws(() => projectRuntimeSchema.parse({ ...manifest, runAs: "root" }));
});

test("a health path must be a path, not a URL to somewhere else", () => {
  assert.throws(() =>
    projectRuntimeSchema.parse({
      ...manifest,
      services: [
        { ...manifest.services[0], healthPath: "http://example.com/" },
        manifest.services[1],
      ],
    }),
  );
});

test("install and check timeouts are bounded", () => {
  assert.throws(() =>
    projectRuntimeSchema.parse({ ...manifest, install: [{ command: "x", timeoutMs: 86_400_000 }] }),
  );
});

// ---------------------------------------------------------------------------
// Backend configuration
// ---------------------------------------------------------------------------

test("an unconfigured project parses to no database and no auth", () => {
  const config = backendConfigurationSchema.parse({});
  assert.equal(config.engine, "none");
  assert.equal(config.auth, "none");
  assert.equal(config.readOnly, true);
  assert.equal(config.ownership, "external");
});

test("JWT auth without an issuer, audience and JWKS URL is refused", () => {
  assert.throws(
    () => backendConfigurationSchema.parse({ auth: "jwt", issuer: "https://id.example.com" }),
    /issuer, audience and JWKS URL/,
  );
  assert.ok(
    backendConfigurationSchema.parse({
      auth: "jwt",
      issuer: "https://id.example.com",
      audience: "my-api",
      jwksUrl: "https://id.example.com/.well-known/jwks.json",
    }),
  );
});

test("secret names are environment-variable shaped", () => {
  assert.ok(backendConfigurationSchema.parse({ secrets: { STRIPE_KEY: "x" } }));
  for (const name of ["lowercase", "WITH-DASH", "1LEADING", "WITH SPACE", "PATH="]) {
    assert.throws(() => backendConfigurationSchema.parse({ secrets: { [name]: "x" } }));
  }
});

test("schema and table names are identifiers, so they cannot carry SQL", () => {
  assert.throws(() => backendConfigurationSchema.parse({ schema: "public; drop table users" }));
  assert.throws(() => backendConfigurationSchema.parse({ tables: ["users; delete from users"] }));
  assert.ok(backendConfigurationSchema.parse({ schema: "public", tables: ["users", "orders"] }));
});
