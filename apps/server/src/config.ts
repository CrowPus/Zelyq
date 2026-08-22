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
  provider: "anthropic" | "google";
  /** After the first account exists, whether strangers may still sign up. */
  allowRegistration: boolean;
  sessionTtlDays: number;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  templatesDir: string;
  /** 32-byte key for settings encryption; generated beside the data when unset. */
  secretKey: string | undefined;
  secretKeyFile: string;
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

export function loadServerConfig(): ServerConfig {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", "..", "..");
  const runtimeKind = (process.env.ZELYQ_RUNTIME ?? "local") as "local" | "remote";

  if (runtimeKind !== "local" && runtimeKind !== "remote") {
    throw new Error(`ZELYQ_RUNTIME must be "local" or "remote", got "${runtimeKind}"`);
  }
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
    // The agent owns provider defaults; the server only records what a session
    // was created with. An empty model means "let the agent decide".
    provider: (process.env.ZELYQ_PROVIDER ?? "anthropic") as ServerConfig["provider"],
    allowRegistration: (process.env.ZELYQ_ALLOW_REGISTRATION ?? "true") !== "false",
    sessionTtlDays: intFromEnv("ZELYQ_SESSION_TTL_DAYS", 30),
    model: process.env.ZELYQ_MODEL ?? "",
    effort: (process.env.ZELYQ_EFFORT ?? "high") as ServerConfig["effort"],
    templatesDir: path.resolve(process.env.ZELYQ_TEMPLATES_DIR ?? path.join(repoRoot, "templates")),
    secretKey: process.env.ZELYQ_SECRET_KEY,
    // Beside the database, so backing up one takes the other.
    secretKeyFile: path.resolve(
      process.env.ZELYQ_SECRET_KEY_FILE ??
        path.join(dataDirFrom(process.env.DATABASE_URL), "secret.key"),
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
    },
  };
}
