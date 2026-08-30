import { resolveFromRepoRoot } from "@zelyq/core/node";
import { createStore, resolveSetting } from "@zelyq/db";
import type { RuntimeConfig } from "@zelyq/runtime";
import {
  apiKeyFromEnv,
  baseUrlFor,
  defaultModelFor,
  isProviderId,
  PROVIDERS,
  type ProviderId,
  requireEncryptedOrLocal,
  speaksOpenAIDialect,
} from "./providers/index.js";

export interface AgentConfig {
  host: string;
  port: number;
  logLevel: string;
  isProduction: boolean;
  corsOrigin: string[];
  provider: ProviderId;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  /** Fallback key for the default provider. A session may supply its own. */
  apiKey: string | undefined;
  /** Endpoint for providers speaking the OpenAI dialect; required for `custom`. */
  baseUrl: string | undefined;
  /** Anthropic only — `anthropic-workspace-id` for an identity-linked key.
   * A session may supply its own. */
  anthropicWorkspaceId: string | undefined;
  maxTurnIterations: number;
  runtime: RuntimeConfig;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}

/** Reads one setting from the database and falls back when it is unavailable. */
async function dbBackedSetting(envVar: string, dbKey: string, fallback: string): Promise<string> {
  if (process.env[envVar]) return process.env[envVar] as string;

  const databaseUrl = process.env.DATABASE_URL ?? "file:./data/zelyq.db";
  const store = createStore(databaseUrl);
  try {
    return await resolveSetting(store.settings, envVar, dbKey, fallback);
  } catch {
    return fallback;
  } finally {
    await store.close().catch(() => undefined);
  }
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
async function containerOptionsFromEnv() {
  // Network egress stays disabled unless an operator explicitly allows hosts.
  const egressAllowlist = await dbBackedSetting(
    "ZELYQ_CONTAINER_EGRESS_ALLOWLIST",
    "containerEgressAllowlist",
    "",
  );

  return {
    ...(process.env.ZELYQ_CONTAINER_IMAGE ? { image: process.env.ZELYQ_CONTAINER_IMAGE } : {}),
    ...(process.env.ZELYQ_CONTAINER_MEMORY ? { memory: process.env.ZELYQ_CONTAINER_MEMORY } : {}),
    ...(process.env.ZELYQ_CONTAINER_CPUS ? { cpus: process.env.ZELYQ_CONTAINER_CPUS } : {}),
    ...(process.env.ZELYQ_CONTAINER_ENGINE ? { engine: process.env.ZELYQ_CONTAINER_ENGINE } : {}),
    // Defaults on inside the driver itself; this is only how to turn it off.
    ...(process.env.ZELYQ_CONTAINER_BLOCK_METADATA === "false"
      ? { blockMetadataEndpoint: false }
      : {}),
    ...(egressAllowlist
      ? {
          egressAllowlist: egressAllowlist
            .split(",")
            .map((hostname) => hostname.trim())
            .filter(Boolean),
        }
      : {}),
  };
}

export async function loadAgentConfig(): Promise<AgentConfig> {
  const runtimeKind = runtimeKindFromEnv();

  const effort = (process.env.ZELYQ_EFFORT ?? "high") as AgentConfig["effort"];

  const provider = process.env.ZELYQ_PROVIDER ?? "anthropic";
  if (!isProviderId(provider)) {
    throw new Error(
      `ZELYQ_PROVIDER must be one of ${Object.keys(PROVIDERS)
        .map((id) => `"${id}"`)
        .join(", ")}, got "${provider}"`,
    );
  }

  const baseUrl = baseUrlFor(provider);
  // Fail at startup rather than on somebody's first prompt. An endpoint that
  // would send source code in clear text is refused here, once, loudly.
  if (baseUrl && speaksOpenAIDialect(provider)) requireEncryptedOrLocal(baseUrl);

  return {
    host: process.env.ZELYQ_AGENT_HOST ?? "127.0.0.1",
    port: intFromEnv("ZELYQ_AGENT_PORT", 8788),
    logLevel: process.env.LOG_LEVEL ?? "info",
    isProduction: process.env.NODE_ENV === "production",
    corsOrigin: (process.env.ZELYQ_CORS_ORIGIN ?? "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    provider,
    // An explicit model wins; otherwise each provider brings its own default,
    // so switching provider does not also require picking a model.
    model: process.env.ZELYQ_MODEL || defaultModelFor(provider),
    effort,
    apiKey: apiKeyFromEnv(provider),
    baseUrl,
    anthropicWorkspaceId: process.env.ANTHROPIC_WORKSPACE_ID || undefined,
    maxTurnIterations: intFromEnv("ZELYQ_MAX_TURN_ITERATIONS", 50),
    runtime: {
      kind: runtimeKind,
      workspaceDir: resolveFromRepoRoot(process.env.ZELYQ_WORKSPACE_DIR ?? "workspace"),
      url: process.env.ZELYQ_RUNTIME_URL,
      token: process.env.ZELYQ_RUNTIME_TOKEN,
      execTimeoutMs: intFromEnv("ZELYQ_EXEC_TIMEOUT_MS", 120_000),
      previewHost: await dbBackedSetting("ZELYQ_PREVIEW_HOST", "previewHost", "127.0.0.1"),
      previewUrlTemplate: process.env.ZELYQ_PREVIEW_URL_TEMPLATE || undefined,
      previewPortRange: [
        intFromEnv("ZELYQ_PREVIEW_PORT_MIN", 4300),
        intFromEnv("ZELYQ_PREVIEW_PORT_MAX", 4399),
      ],
      container: await containerOptionsFromEnv(),
    },
  };
}
