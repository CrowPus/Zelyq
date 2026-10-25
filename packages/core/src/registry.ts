// ---------------------------------------------------------------------------
// The plugin registry: Zelyq's own pipeline plugins, signed, served only to
// Zelyq installations (apps/registry, at zelyq.store).
// ---------------------------------------------------------------------------

/** Where installations find the registry unless an instance says otherwise. */
export const DEFAULT_REGISTRY_URL = "https://zelyq.store";

/**
 * The exact bytes the registry signs for one version. Shared, so the
 * registry and every installation agree to the byte.
 */
export function pluginSignaturePayload(id: string, version: string, sha256: string): string {
  return `zelyq-plugin-v1\n${id}\n${version}\n${sha256}`;
}

/** One plugin as the registry lists it. */
export interface RegistryPluginSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  latestVersion: string;
  /** Operating systems its latest version runs on. */
  os: string[];
  updatedAt: string;
}

/** One version of a plugin, as the registry describes it. */
export interface RegistryPluginVersion {
  version: string;
  sha256: string;
  signature: string;
  keyId: string;
  sizeBytes: number;
  changelog: string | null;
  publishedAt: string;
  yanked: { at: string; reason: string } | null;
}

/** A plugin with its README, inputs and every version. */
export interface RegistryPluginDetail extends RegistryPluginSummary {
  readme: string;
  /** The latest version's inputs: name → description, required, secret. */
  inputs: Record<string, { description: string; required: boolean; secret: boolean }>;
  versions: RegistryPluginVersion[];
}
