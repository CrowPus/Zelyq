import { randomBytes, randomUUID } from "node:crypto";
import {
  type BackendConfiguration,
  type BackendConfigurationInput,
  type BackendConfigurationResolved,
  backendConfigurationSchema,
  LOCAL_DEVELOPMENT_DATABASE,
  ZelyqError,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";
import { type PreviewOptions, type RuntimeDriver, readRuntimeManifest } from "@zelyq/runtime";
import type { SecretBox } from "./secrets.js";

type Environment = "development" | "test" | "production";
interface Stored {
  config: BackendConfigurationResolved;
  revision: string;
}
const reserved =
  /^(?:ZELYQ_|VITE_|EXPO_|NODE_|PYTHON|UV_|PATH$|HOME$|LD_|DYLD_|DATABASE_|AUTH_|SUPABASE_)/;

/**
 * Refuse database hosts that only ever name this machine or its cloud
 * metadata service.
 *
 * A connection test runs inside the project runtime, which sits on the Zelyq
 * host's network, so `postgresql://…@127.0.0.1:5432/zelyq` is a request to the
 * platform's own database rather than to a user's. A pair of literal hostnames
 * did not cover the IPv6 metadata address, IPv4-mapped forms, or the integer
 * and hex spellings of an address that `URL` happily accepts.
 *
 * RFC1918 ranges stay permitted: a self-hosted database on a private network is
 * the normal case, and restricting it belongs to the operator's network policy,
 * not to a string check here.
 */

/**
 * The 32-bit address a resolver would produce for an IPv4 literal, or `null`
 * when the host is a name rather than an address.
 *
 * Deliberately permissive in the same way `inet_aton` is, because that is what
 * actually resolves the string: `127.1`, `0x7f.1`, `017700000001` and
 * `2130706433` all reach loopback, and a check that only understands dotted
 * quads waves every one of them through.
 */
function ipv4From(host: string): number | null {
  const parts = host.split(".");
  if (parts.length > 4) return null;

  const values: number[] = [];
  for (const part of parts) {
    if (!/^(0x[0-9a-f]+|0[0-7]*|[1-9][0-9]*|0)$/.test(part)) return null;
    const value = part.startsWith("0x")
      ? Number.parseInt(part.slice(2), 16)
      : /^0[0-7]+$/.test(part)
        ? Number.parseInt(part.slice(1), 8)
        : Number(part);
    if (!Number.isFinite(value) || value < 0) return null;
    values.push(value);
  }
  if (values.length === 0) return null;

  // The final part fills whatever octets the earlier ones did not name.
  const last = values.pop() as number;
  const filled = 4 - values.length;
  if (last >= 2 ** (8 * filled)) return null;
  if (values.some((value) => value > 0xff)) return null;

  let address = last;
  for (const [index, value] of values.entries()) {
    address += value * 2 ** (8 * (3 - index));
  }
  return address > 0xffffffff ? null : address >>> 0;
}

// See the note above `ipv4From` for why the spellings matter.
function assertReachableDatabaseHost(hostname: string): void {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const refuse = () => {
    throw ZelyqError.badRequest(
      "That database host is not permitted. Give the address the database is reachable at " +
        "from the runtime — not this machine's loopback or its cloud metadata service.",
    );
  };

  if (host === "metadata.google.internal" || host.endsWith(".metadata.internal")) refuse();
  if (host === "localhost" || host.endsWith(".localhost")) refuse();

  // An IPv4-mapped address is the same address wearing an IPv6 prefix — and
  // `URL` rewrites ::ffff:127.0.0.1 into its hex form ::ffff:7f00:1, so both
  // spellings have to come back to the v4 address they mean.
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  const unmapped = mappedHex
    ? String(
        // >>> 0, or the sign bit makes 169.254.x.x a negative number and the
        // address parses as a hostname instead.
        ((Number.parseInt(mappedHex[1] as string, 16) << 16) >>> 0) +
          Number.parseInt(mappedHex[2] as string, 16),
      )
    : host.replace(/^::ffff:/, "");

  const address = ipv4From(unmapped);
  if (address !== null) {
    const a = (address >>> 24) & 0xff;
    const b = (address >>> 16) & 0xff;
    if (a === 127 || a === 0) refuse(); // loopback, and "this host"
    if (a === 169 && b === 254) refuse(); // link-local, including the cloud IMDS
  }

  if (host === "::1" || host === "::" || host === "0:0:0:0:0:0:0:1") refuse();
  if (/^fe[89ab][0-9a-f]:/.test(host)) refuse(); // IPv6 link-local
  if (host === "fd00:ec2::254") refuse(); // the EC2 IMDS over IPv6
}

/**
 * Whether this is the project's own SQLite build database rather than a
 * database belonging to someone.
 *
 * A custom `databaseUrl` disqualifies it even when the engine is SQLite: the
 * automatic-migration decision must rest on "Zelyq made this file and only this
 * app's data is in it", not on the engine alone.
 */
function isLocalBuildDatabase(config: BackendConfigurationResolved): boolean {
  return config.engine === "sqlite" && config.ownership === "application" && !config.databaseUrl;
}

export class ProjectBackendService {
  private grants = new Map<
    string,
    { projectId: string; userId: string; sessionId: string; expires: number }
  >();
  constructor(
    private store: Store,
    private secrets: SecretBox,
    private runtime: RuntimeDriver,
  ) {}

  private key(id: string, environment: Environment): string {
    return `project-backend:${id}:${environment}`;
  }
  private async load(id: string, environment: Environment): Promise<Stored> {
    const encrypted = await this.store.settings.get(this.key(id, environment));
    // Nothing saved is not "no database". A project starts with its own local
    // one so that an app which saves things works the moment it is created —
    // see LOCAL_DEVELOPMENT_DATABASE. `revision` is stable so this does not
    // restart a running preview on every status call.
    if (!encrypted)
      return {
        config: backendConfigurationSchema.parse(
          environment === "development" ? LOCAL_DEVELOPMENT_DATABASE : {},
        ),
        revision: environment === "development" ? "local-development" : "unconfigured",
      };
    const raw = this.secrets.decrypt(encrypted);
    if (!raw)
      throw ZelyqError.badRequest(
        "Backend configuration could not be decrypted. Reconnect this project's backend.",
      );
    return JSON.parse(raw) as Stored;
  }
  async get(id: string, environment: Environment = "development"): Promise<BackendConfiguration> {
    const { config, revision } = await this.load(id, environment);
    const { databaseUrl, secrets, ...publicConfig } = config;
    return {
      ...publicConfig,
      configured: Boolean(databaseUrl) || config.engine === "sqlite",
      secretNames: Object.keys(secrets),
      revision,
    };
  }
  async save(
    id: string,
    raw: BackendConfigurationInput,
    environment: Environment = "development",
  ): Promise<BackendConfiguration> {
    // Parsed here as well as at the route. This is what settles whether a
    // connection may write, so it must not depend on every caller having
    // remembered to resolve the defaults first.
    const input = backendConfigurationSchema.parse(raw);
    const previous = await this.load(id, environment);
    const config = {
      ...input,
      databaseUrl:
        input.databaseUrl === undefined ? previous.config.databaseUrl : input.databaseUrl,
      secrets: { ...previous.config.secrets },
    };
    for (const [key, value] of Object.entries(input.secrets)) {
      if (reserved.test(key))
        throw ZelyqError.badRequest(`Use the dedicated configuration fields for ${key}.`);
      if (value === null) delete config.secrets[key];
      else config.secrets[key] = value;
    }
    if (config.databaseUrl) {
      if (config.engine === "none" || config.engine === "supabase")
        throw ZelyqError.badRequest("Select a SQL engine to configure a database URL.");
      if (config.engine === "sqlite")
        throw ZelyqError.badRequest(
          "SQLite uses this project's persistent application.db file; external paths are not accepted.",
        );
      let url: URL;
      try {
        url = new URL(config.databaseUrl);
      } catch {
        throw ZelyqError.badRequest("Invalid database URL.");
      }
      const scheme = url.protocol.split("+")[0]?.replace(":", "");
      if (scheme !== config.engine)
        throw ZelyqError.badRequest("The URL does not match the selected database engine.");
      assertReachableDatabaseHost(url.hostname);
    }
    if (config.auth === "jwt") {
      for (const target of [config.issuer!, config.jwksUrl!])
        if (new URL(target).protocol !== "https:")
          throw ZelyqError.badRequest("Authentication endpoints must use HTTPS.");
    }
    await this.store.settings.set(
      this.key(id, environment),
      this.secrets.encrypt(JSON.stringify({ config, revision: randomUUID() })),
    );
    return this.get(id, environment);
  }
  async remove(id: string, environment: Environment = "development"): Promise<void> {
    await this.store.settings.remove(this.key(id, environment));
  }
  async previewOptions(
    id: string,
    publicEnv: Record<string, string> = {},
  ): Promise<PreviewOptions> {
    if (!(await readRuntimeManifest(this.runtime, id))) return { env: publicEnv };
    const { config, revision } = await this.load(id, "development");
    const backendEnv: Record<string, string> = {
      DATABASE_ENGINE: config.engine,
      DATABASE_READ_ONLY: String(config.readOnly),
      DATABASE_OWNERSHIP: config.ownership,
      DATABASE_TABLES: config.tables.join(","),
      AUTH_MODE: config.auth,
      ...(config.databaseUrl ? { DATABASE_URL: config.databaseUrl } : {}),
      ...(config.schema ? { DATABASE_SCHEMA: config.schema } : {}),
      ...(config.issuer ? { AUTH_ISSUER: config.issuer } : {}),
      ...(config.audience ? { AUTH_AUDIENCE: config.audience } : {}),
      ...(config.jwksUrl ? { AUTH_JWKS_URL: config.jwksUrl } : {}),
      ...(publicEnv.VITE_SUPABASE_URL ? { SUPABASE_URL: publicEnv.VITE_SUPABASE_URL } : {}),
      ...(publicEnv.VITE_SUPABASE_PUBLISHABLE_KEY
        ? { SUPABASE_PUBLISHABLE_KEY: publicEnv.VITE_SUPABASE_PUBLISHABLE_KEY }
        : {}),
      // Only a database this application owns, that Zelyq created, and that
      // holds nothing but this app's own data is brought up to date on its
      // own. A user's PostgreSQL or MySQL is never migrated without them
      // asking, whatever the project's manifest says.
      ...(isLocalBuildDatabase(config) ? { ZELYQ_DB_AUTOMIGRATE: "1" } : {}),
    };
    for (const [key, value] of Object.entries(config.secrets))
      if (value !== null) backendEnv[key] = value;
    return { env: publicEnv, backendEnv, configurationRevision: revision };
  }
  async inspect(id: string): Promise<unknown> {
    const options = await this.previewOptions(id);
    if (!options.backendEnv)
      throw ZelyqError.badRequest("This project does not have a Python runtime manifest.");
    const config = await this.get(id);
    if (["none", "supabase"].includes(config.engine))
      throw ZelyqError.badRequest("Select a direct SQL database first.");
    const result = await this.runtime.exec(id, {
      command: "uv run --locked --no-sync python -m app.inspect_database",
      cwd: "backend",
      env: options.backendEnv,
      timeoutMs: 30_000,
      maxOutputBytes: 32000,
    });
    // Driver failures can include a URL/password. Never forward arbitrary stderr.
    if (result.exitCode !== 0)
      return {
        connected: false,
        error:
          "Connection failed. Check runtime network access, TLS, credentials and selected table permissions.",
      };
    try {
      return JSON.parse(result.stdout);
    } catch {
      return { connected: false, error: "The database probe did not return a valid result." };
    }
  }
  mint(sessionId: string, projectId: string, userId: string): string {
    for (const [token, grant] of this.grants)
      if (grant.sessionId === sessionId || grant.expires < Date.now()) this.grants.delete(token);
    const token = randomBytes(32).toString("base64url");
    this.grants.set(token, {
      sessionId,
      projectId,
      userId,
      expires: Date.now() + 12 * 60 * 60_000,
    });
    return token;
  }
  resolve(token: string): { projectId: string; userId: string } | null {
    const grant = this.grants.get(token);
    // Exactly what the caller is entitled to act on — the session id and the
    // expiry stay in here rather than travelling with every resolved grant.
    return grant && grant.expires > Date.now()
      ? { projectId: grant.projectId, userId: grant.userId }
      : null;
  }
}
