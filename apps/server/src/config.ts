import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeConfig } from "@zelyq/runtime";

export interface ServerConfig {
  host: string;
  port: number;
  logLevel: string;
  isProduction: boolean;
  corsOrigin: string[];
  databaseUrl: string;
  agentUrl: string;
  /**
   * 058 · Phase C — URL the agent calls back on for the Supabase bridge
   * (applying migrations through the server). Defaults to loopback on the
   * server's own port; set it when the agent runs on another host.
   */
  serverInternalUrl: string;
  provider: "anthropic" | "google";
  /** After the first account exists, whether strangers may still sign up. */
  allowRegistration: boolean;
  sessionTtlDays: number;
  oidc?: {
    issuer: string | undefined;
    clientId: string | undefined;
    clientSecret: string | undefined;
    redirectUri: string | undefined;
  };
  /**
   * 058 · Phase A — an optional Supabase OAuth app registration. When present,
   * the UI offers "Connect with Supabase" (scoped, refreshable tokens);
   * otherwise only the Personal Access Token path is available.
   */
  supabaseOAuth?: {
    clientId: string;
    clientSecret: string;
    redirectUrl: string;
  };
  /**
   * 058 · Phase C — domain for the throwaway user the backend verification
   * signs up. Supabase's email validator rejects domains with no MX records
   * (`example.com` among them), so set this to one that resolves. Defaults to
   * `example.com` when unset.
   */
  supabaseVerifyEmailDomain?: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  templatesDir: string;
  /** 32-byte key for settings encryption; generated beside the data when unset. */
  secretKey: string | undefined;
  secretKeyFile: string;
  /**
   * Where uploaded prompt attachments live — beside the database, never
   * inside a project's own workspace. An uploaded image is conversation
   * data, not project data, and a project's own files are committed to git
   * automatically — an attachment landing in that history by accident is not
   * this feature's call to make.
   */
  attachmentsDir: string;
  /**
   * Where a skill uploaded through Settings is written. The agent reads this
   * same directory as its own
   * "uploaded" skills source; the default here and the agent's own default
   * are the same relative shape `ZELYQ_WORKSPACE_DIR` already establishes
   * for a directory both processes need to agree on.
   */
  uploadedSkillsDir: string;
  /**
   * Where Claude Code's own CLI stores its session. Always the server
   * process's own `$HOME` in a real
   * deployment, which is why nothing here reads an environment variable
   * for it; a test constructs `ServerConfig` directly and points this at a
   * fixture instead.
   */
  claudeCredentialsPath?: string;
  /** Same, for Codex's session. */
  codexCredentialsPath?: string;
  /** Built web assets to serve. Absent in development, where Vite serves them. */
  webDir: string | null;
  runtime: RuntimeConfig;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}

/** The directory holding a SQLite database, or ./data for anything else. */
function dataDirFrom(databaseUrl: string | undefined): string {
  if (databaseUrl?.startsWith("file:")) return path.dirname(path.resolve(databaseUrl.slice(5)));
  return path.resolve("./data");
}

const RUNTIME_KINDS = ["local", "remote", "container"] as const;

function runtimeKindFromEnv(): (typeof RUNTIME_KINDS)[number] {
  const kind = process.env.ZELYQ_RUNTIME ?? "local";
  if (!(RUNTIME_KINDS as readonly string[]).includes(kind)) {
    throw new Error(
      `ZELYQ_RUNTIME must be one of ${RUNTIME_KINDS.map((k) => `"${k}"`).join(", ")}, got "${kind}"`,
    );
  }
  return kind as (typeof RUNTIME_KINDS)[number];
}

/** Image, limits and engine for `ZELYQ_RUNTIME=container`. */
function containerOptionsFromEnv() {
  return {
    ...(process.env.ZELYQ_CONTAINER_IMAGE ? { image: process.env.ZELYQ_CONTAINER_IMAGE } : {}),
    ...(process.env.ZELYQ_CONTAINER_MEMORY ? { memory: process.env.ZELYQ_CONTAINER_MEMORY } : {}),
    ...(process.env.ZELYQ_CONTAINER_CPUS ? { cpus: process.env.ZELYQ_CONTAINER_CPUS } : {}),
    ...(process.env.ZELYQ_CONTAINER_ENGINE ? { engine: process.env.ZELYQ_CONTAINER_ENGINE } : {}),
    // Defaults on inside the driver itself; this is only how to turn it off.
    ...(process.env.ZELYQ_CONTAINER_BLOCK_METADATA === "false"
      ? { blockMetadataEndpoint: false }
      : {}),
    // Defaults off inside the driver itself, and stays off unless an operator
    // names hosts here — there is no Zelyq-maintained default list.
    ...(process.env.ZELYQ_CONTAINER_EGRESS_ALLOWLIST
      ? {
          egressAllowlist: process.env.ZELYQ_CONTAINER_EGRESS_ALLOWLIST.split(",")
            .map((hostname) => hostname.trim())
            .filter(Boolean),
        }
      : {}),
  };
}

export function loadServerConfig(): ServerConfig {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", "..", "..");
  const runtimeKind = runtimeKindFromEnv();

  if (runtimeKind === "remote" && !process.env.ZELYQ_RUNTIME_URL) {
    throw new Error("ZELYQ_RUNTIME=remote requires ZELYQ_RUNTIME_URL");
  }

  return {
    host: process.env.ZELYQ_SERVER_HOST ?? "127.0.0.1",
    port: intFromEnv("ZELYQ_SERVER_PORT", 8787),
    logLevel: process.env.LOG_LEVEL ?? "info",
    isProduction: process.env.NODE_ENV === "production",
    corsOrigin: (process.env.ZELYQ_CORS_ORIGIN ?? "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    databaseUrl: process.env.DATABASE_URL ?? "file:./data/zelyq.db",
    agentUrl: process.env.ZELYQ_AGENT_URL ?? "http://127.0.0.1:8788",
    serverInternalUrl:
      process.env.ZELYQ_SERVER_INTERNAL_URL ??
      `http://127.0.0.1:${intFromEnv("ZELYQ_SERVER_PORT", 8787)}`,
    // The agent owns provider defaults; the server only records what a session
    // was created with. An empty model means "let the agent decide".
    provider: (process.env.ZELYQ_PROVIDER ?? "anthropic") as ServerConfig["provider"],
    allowRegistration: (process.env.ZELYQ_ALLOW_REGISTRATION ?? "true") !== "false",
    sessionTtlDays: intFromEnv("ZELYQ_SESSION_TTL_DAYS", 30),
    oidc: {
      issuer: process.env.ZELYQ_OIDC_ISSUER,
      clientId: process.env.ZELYQ_OIDC_CLIENT_ID,
      clientSecret: process.env.ZELYQ_OIDC_CLIENT_SECRET,
      redirectUri: process.env.ZELYQ_OIDC_REDIRECT_URI,
    },
    supabaseOAuth:
      process.env.ZELYQ_SUPABASE_OAUTH_CLIENT_ID && process.env.ZELYQ_SUPABASE_OAUTH_CLIENT_SECRET
        ? {
            clientId: process.env.ZELYQ_SUPABASE_OAUTH_CLIENT_ID,
            clientSecret: process.env.ZELYQ_SUPABASE_OAUTH_CLIENT_SECRET,
            redirectUrl:
              process.env.ZELYQ_SUPABASE_OAUTH_REDIRECT_URL ??
              `${(process.env.ZELYQ_PUBLIC_URL ?? "http://localhost:5173").replace(/\/$/, "")}/api/integrations/supabase/oauth/callback`,
          }
        : undefined,
    supabaseVerifyEmailDomain:
      process.env.ZELYQ_SUPABASE_VERIFY_EMAIL_DOMAIN?.trim() || "example.com",
    model: process.env.ZELYQ_MODEL ?? "",
    effort: (process.env.ZELYQ_EFFORT ?? "high") as ServerConfig["effort"],
    templatesDir: path.resolve(process.env.ZELYQ_TEMPLATES_DIR ?? path.join(repoRoot, "templates")),
    secretKey: process.env.ZELYQ_SECRET_KEY,
    // Beside the database, so backing up one takes the other.
    secretKeyFile: path.resolve(
      process.env.ZELYQ_SECRET_KEY_FILE ??
        path.join(dataDirFrom(process.env.DATABASE_URL), "secret.key"),
    ),
    attachmentsDir: path.resolve(
      process.env.ZELYQ_ATTACHMENTS_DIR ??
        path.join(dataDirFrom(process.env.DATABASE_URL), "attachments"),
    ),
    uploadedSkillsDir: path.resolve(
      process.env.ZELYQ_SKILLS_UPLOAD_DIR ??
        path.join(dataDirFrom(process.env.DATABASE_URL), "skills"),
    ),
    webDir: process.env.ZELYQ_WEB_DIR
      ? path.resolve(process.env.ZELYQ_WEB_DIR)
      : process.env.NODE_ENV === "production"
        ? path.join(repoRoot, "apps", "web", "dist")
        : null,
    runtime: {
      kind: runtimeKind,
      workspaceDir: path.resolve(process.env.ZELYQ_WORKSPACE_DIR ?? "./workspace"),
      url: process.env.ZELYQ_RUNTIME_URL,
      token: process.env.ZELYQ_RUNTIME_TOKEN,
      execTimeoutMs: intFromEnv("ZELYQ_EXEC_TIMEOUT_MS", 120_000),
      previewPortRange: [
        intFromEnv("ZELYQ_PREVIEW_PORT_MIN", 4300),
        intFromEnv("ZELYQ_PREVIEW_PORT_MAX", 4399),
      ],
      previewHost: process.env.ZELYQ_PREVIEW_HOST ?? "127.0.0.1",
      container: containerOptionsFromEnv(),
    },
  };
}
