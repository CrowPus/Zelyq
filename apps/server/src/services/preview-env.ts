import type { SupabaseConnectionService } from "./supabase-connections.js";

/**
 * Proposal 058 · Phase A — the one path that supplies a running preview with
 * its backend configuration.
 *
 * It returns **only** the public browser values: the project URL and the
 * publishable key. A Management credential (PAT / OAuth token) or a provider
 * secret key never passes through here — by construction, this function has no
 * way to read one. Both preview entry points (the server route and the agent
 * `start_preview` tool) call the same resolver so neither can drift.
 */
export type PreviewEnvResolver = (zelyqProjectId: string) => Promise<Record<string, string>>;

export function makePreviewEnvResolver(deps: {
  supabaseConnections: SupabaseConnectionService;
}): PreviewEnvResolver {
  return async function resolvePreviewEnv(zelyqProjectId: string): Promise<Record<string, string>> {
    const resource = await deps.supabaseConnections.getLinkedResource(zelyqProjectId);
    if (!resource) return {};
    return {
      VITE_SUPABASE_URL: resource.projectUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: resource.publishableKey,
    };
  };
}
