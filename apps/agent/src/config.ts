import path from "node:path";
import type { RuntimeConfig } from "@zelyq/runtime";
import {
  type ProviderId,
  apiKeyFromEnv,
  defaultModelFor,
  isProviderId,
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

export function loadAgentConfig(): AgentConfig {
  const runtimeKind = (process.env.ZELYQ_RUNTIME ?? "local") as "local" | "remote";
  if (runtimeKind !== "local" && runtimeKind !== "remote") {
    throw new Error(`ZELYQ_RUNTIME must be "local" or "remote", got "${runtimeKind}"`);
  }

  const effort = (process.env.ZELYQ_EFFORT ?? "high") as AgentConfig["effort"];

  const provider = process.env.ZELYQ_PROVIDER ?? "anthropic";
  if (!isProviderId(provider)) {
    throw new Error(`ZELYQ_PROVIDER must be "anthropic" or "google", got "${provider}"`);
  }

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
    maxTurnIterations: intFromEnv("ZELYQ_MAX_TURN_ITERATIONS", 50),
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
