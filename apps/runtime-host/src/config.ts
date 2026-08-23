import path from "node:path";
import type { HostConfig } from "./app.js";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}

export function loadHostConfig(): HostConfig {
  return {
    host: process.env.ZELYQ_HOST_BIND ?? "127.0.0.1",
    port: intFromEnv("ZELYQ_HOST_PORT", 8790),
    logLevel: process.env.LOG_LEVEL ?? "info",
    token: process.env.ZELYQ_RUNTIME_TOKEN || undefined,
    runtime: {
      kind: "local",
      workspaceDir: path.resolve(process.env.ZELYQ_WORKSPACE_DIR ?? "./workspace"),
      execTimeoutMs: intFromEnv("ZELYQ_EXEC_TIMEOUT_MS", 120_000),
      previewPortRange: [
        intFromEnv("ZELYQ_PREVIEW_PORT_MIN", 4300),
        intFromEnv("ZELYQ_PREVIEW_PORT_MAX", 4399),
      ],
      previewHost: process.env.ZELYQ_PREVIEW_HOST ?? "127.0.0.1",
    },
  };
}
