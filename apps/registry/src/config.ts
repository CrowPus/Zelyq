import path from "node:path";
import { resolveFromRepoRoot } from "@zelyq/core/node";

export interface RegistryConfig {
  host: string;
  port: number;
  /** Where the database, the signing key and the packages live. */
  dataDir: string;
  /** The public address, e.g. https://zelyq.store — for cookies and origin checks. */
  publicUrl: string | null;
  trustProxy: boolean;
  logLevel: string;
}

export function loadRegistryConfig(): RegistryConfig {
  const dataDir = resolveFromRepoRoot(
    process.env.REGISTRY_DATA_DIR ?? path.join("data", "registry"),
  );
  return {
    host: process.env.REGISTRY_HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.REGISTRY_PORT ?? "8096", 10),
    dataDir,
    publicUrl: process.env.REGISTRY_PUBLIC_URL?.replace(/\/+$/, "") || null,
    trustProxy: process.env.REGISTRY_TRUST_PROXY === "true",
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
}
